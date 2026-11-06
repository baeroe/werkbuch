<?php

use App\Actions\Account\ChangePassword;
use App\Events\EventType;
use App\Exceptions\Problem;
use App\Models\Event;
use App\Models\User;
use Illuminate\Support\Facades\Auth;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Hash;

/*
 * Changing the own password from the settings (spec 4.2, P25): the current one first, the new one twice; the rules,
 * the hash, the other sessions and the event are SetPassword's. The session it happens in stays signed in.
 */

it('names a wrong current password at its field and changes nothing', function () {
    speakGerman();
    $lene = User::factory()->create(['password' => 'old-password']);

    $this->actingAs($lene)->putJson('/api/v1/me/password', ['current_password' => 'nope', 'password' => 'new-password', 'password_confirmation' => 'new-password'])
        ->assertUnprocessable()->assertJsonPath('errors.current_password', ['Das aktuelle Passwort stimmt nicht.'])
        ->assertJsonMissingPath('errors.password');

    expect(Hash::check('old-password', (string) $lene->fresh()?->password))->toBeTrue()
        ->and(Event::query()->where('type', EventType::UserPasswordChanged)->exists())->toBeFalse();
});

it('wants the current password', function (array $input) {
    $this->actingAs(User::factory()->create(['password' => 'old-password']))
        ->putJson('/api/v1/me/password', $input + ['password' => 'new-password', 'password_confirmation' => 'new-password'])
        ->assertUnprocessable()->assertJsonPath('errors.current_password', [__('field.current_password.wrong')]);
})->with(['missing' => [[]], 'a list' => [['current_password' => ['old-password']]]]);

it('names a new password that is too short or typed differently at the field', function (array $input, string $message) {
    speakGerman();
    $lene = User::factory()->create(['password' => 'old-password']);

    $this->actingAs($lene)->putJson('/api/v1/me/password', ['current_password' => 'old-password'] + $input)
        ->assertUnprocessable()->assertJsonPath('errors.password.0', $message);

    expect(Hash::check('old-password', (string) $lene->fresh()?->password))->toBeTrue();
})->with([
    'too short' => [['password' => 'short', 'password_confirmation' => 'short'], 'Passwort muss mindestens 8 Zeichen lang sein.'],
    'typed differently' => [['password' => 'new-password', 'password_confirmation' => 'new-passwort'], 'Die Passwörter stimmen nicht überein.'],
    'missing' => [[], 'Passwort ist erforderlich.'],
]);

it('changes the password, ends the other sessions and keeps the own one', function () {
    config(['session.driver' => 'database']);
    $lene = User::factory()->create(['email' => 'lene@example.com', 'password' => 'old-password']);
    DB::table('sessions')->insert(['id' => 'elsewhere', 'user_id' => $lene->id, 'payload' => '', 'last_activity' => time()]);

    $login = $this->post('/login', ['email' => 'lene@example.com', 'password' => 'old-password']);
    $session = (string) $login->getCookie(config('session.cookie'))?->getValue();
    // the interface: the session cookie of the page it runs on (Sanctum stateful; JSON requests send cookies only withCredentials)
    $api = fn () => $this->withCredentials()->withCookie(config('session.cookie'), $session)->withHeader('Referer', config('app.url'));
    Auth::forgetGuards();

    $api()->putJson('/api/v1/me/password', ['current_password' => 'old-password', 'password' => 'new-password', 'password_confirmation' => 'new-password'])
        ->assertNoContent();
    Auth::forgetGuards();

    expect(Hash::check('new-password', (string) $lene->fresh()?->password))->toBeTrue()
        ->and(DB::table('sessions')->where('user_id', $lene->id)->pluck('id')->all())->toBe([$session]);
    $api()->getJson('/api/v1/organization')->assertOk();

    $event = Event::query()->where('type', EventType::UserPasswordChanged)->sole();
    expect([$event->actor_id, $event->subject_id, $event->changes, $event->meta['via'], $event->meta['reason']])
        ->toBe([$lene->id, $lene->id, null, 'ui', 'password_change'])
        ->and(json_encode($event->toArray()))->not->toContain('new-password');
});

it('signs out a session elsewhere that still carries the old password', function (bool $change) {
    $lene = User::factory()->create(['email' => 'lene@example.com', 'password' => 'old-password']);
    $oldHash = (string) $lene->password;
    $this->post('/login', ['email' => 'lene@example.com', 'password' => 'old-password']);
    Auth::forgetGuards();

    if ($change) {
        $this->withHeader('Referer', config('app.url'))->putJson('/api/v1/me/password', ['current_password' => 'old-password', 'password' => 'new-password', 'password_confirmation' => 'new-password'])
            ->assertNoContent();
    }

    // another browser of Lene's, signed in before the change: its session holds the hash of the old password
    $this->flushSession();
    $this->withSession([Auth::guard('web')->getName() => $lene->id, 'password_hash_web' => $oldHash]);
    // a new request starts with the web guard again (auth:sanctum made sanctum the default of this test's app)
    Auth::shouldUse('web');
    Auth::forgetGuards();

    if ($change) {
        $this->get('/my-items')->assertRedirect('/login');
        $this->assertGuest();
    } else {
        $this->get('/my-items')->assertOk();
    }
})->with(['after the change' => true, 'without a change' => false]);

it('is only for people', function () {
    $bot = User::factory()->bot()->create();

    expect(fn () => ChangePassword::run(actor($bot), ['current_password' => 'x', 'password' => 'new-password', 'password_confirmation' => 'new-password']))
        ->toThrow(fn (Problem $problem) => expect([$problem->status, $problem->detail])->toBe([403, __('problem.detail.people_only')]));
});

it('limits the tries to six a minute per account and names the wait at the current password', function () {
    $this->freezeTime();
    $lene = User::factory()->create(['password' => 'old-password']);
    $wrong = ['current_password' => 'nope', 'password' => 'new-password', 'password_confirmation' => 'new-password'];

    foreach (range(1, 6) as $i) {
        $this->actingAs($lene)->putJson('/api/v1/me/password', $wrong)->assertUnprocessable();
    }

    $this->putJson('/api/v1/me/password', [...$wrong, 'current_password' => 'old-password'])->assertTooManyRequests()
        ->assertHeader('Content-Type', 'application/problem+json')->assertHeader('Retry-After', '60')
        ->assertJsonPath('reason', 'too_many_requests')
        ->assertJsonPath('errors.current_password', [__('auth.throttle', ['seconds' => 60])]);
    expect(Hash::check('old-password', (string) $lene->fresh()?->password))->toBeTrue();

    // another account has its own tries (the guard web: the throttle reads the session before auth)
    forgetApiAuth();
    $this->actingAs(User::factory()->create(['password' => 'other-password']), 'web')
        ->putJson('/api/v1/me/password', [...$wrong, 'current_password' => 'other-password'])->assertNoContent();
});

it('counts a token at the session-only route by its address, never against the tries of the account', function () {
    $this->freezeTime();
    $lene = User::factory()->create(['password' => 'old-password']);
    $change = ['current_password' => 'old-password', 'password' => 'new-password', 'password_confirmation' => 'new-password'];

    // a token gets 403 session_required here and counts by its address; however often it knocks, the six tries of the
    // owner's session stay (T6-M4: RateKey, never $request->user(), which before Auth may be the token or nobody)
    $this->withToken(apiToken($lene, ['read', 'write']));
    foreach (range(1, 8) as $i) {
        $this->putJson('/api/v1/me/password', $change)->assertStatus($i <= 6 ? 403 : 429);
    }

    forgetApiAuth();
    $this->withoutToken()->actingAs($lene, 'web')->putJson('/api/v1/me/password', $change)->assertNoContent();
});
