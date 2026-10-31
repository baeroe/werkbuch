<?php

use App\Access\ProjectRole;
use App\Access\Visibility;
use App\Actions\Users\DeactivateUser;
use App\Actions\Users\ReactivateUser;
use App\Events\EventType;
use App\Models\Event;
use App\Models\Project;
use App\Models\User;
use Illuminate\Support\Facades\Auth;
use Illuminate\Support\Facades\DB;

/*
 * Deactivating instead of deleting (spec 4.2): tokens and sessions are revoked, the account stays. Review focus: a
 * deactivated account reaches nothing any more, neither with a token nor with a session.
 */

it('revokes the tokens of the account', function (Closure $account) {
    $this->freezeSecond();
    $admin = User::factory()->admin()->create();
    $user = $account();
    $token = apiToken($user, ['read']);
    $this->withToken($token)->getJson('/api/v1/users')->assertOk();
    forgetApiAuth();

    $this->withToken(apiToken($admin, ['write']))->postJson("/api/v1/users/{$user->id}/deactivate")
        ->assertOk()->assertJsonPath('data.id', $user->id)->assertJsonPath('data.disabled_at', now()->toJSON());
    forgetApiAuth();

    $this->withToken($token)->getJson('/api/v1/users')->assertUnauthorized()->assertHeader('Content-Type', 'application/problem+json');
    expect($user->tokens()->count())->toBe(0)
        ->and(Event::query()->where('type', EventType::UserDeactivated)->where('subject_id', $user->id)->sole()->actor_id)->toBe($admin->id);
})->with([
    'person' => [fn () => User::factory()->create()],
    'bot' => [fn () => User::factory()->bot()->create()],
]);

it('leaves the tokens of everybody else alone', function () {
    $admin = User::factory()->admin()->create();
    $other = User::factory()->create();
    apiToken($other, ['read']);

    DeactivateUser::run(actor($admin), User::factory()->create());

    expect($other->tokens()->count())->toBe(1);
});

it('ends the stored sessions, so a session that was signed in gets 401 from the API', function () {
    config(['session.driver' => 'database']);
    $admin = User::factory()->admin()->create();
    $lene = User::factory()->create(['email' => 'lene@example.com', 'password' => 'lene-password']);

    $login = $this->post('/login', ['email' => 'lene@example.com', 'password' => 'lene-password']);
    $session = (string) $login->getCookie(config('session.cookie'))?->getValue();
    // the interface: the session cookie from the page it runs on (Sanctum stateful)
    $api = fn () => $this->withCookie(config('session.cookie'), $session)->withHeader('Referer', config('app.url'))->getJson('/api/v1/users');
    Auth::forgetGuards();
    $api()->assertOk();
    expect(DB::table('sessions')->where('user_id', $lene->id)->pluck('id')->all())->toBe([$session]);

    DeactivateUser::run(actor($admin), $lene);
    Auth::forgetGuards();

    expect(DB::table('sessions')->where('user_id', $lene->id)->count())->toBe(0);
    $api()->assertUnauthorized()->assertHeader('Content-Type', 'application/problem+json');
});

it('signs out a session elsewhere on its next request to the API', function () {
    $admin = User::factory()->admin()->create();
    $lene = User::factory()->create();
    $this->actingAs($lene)->getJson('/api/v1/users')->assertOk();

    // the session keeps its account in memory; whatever the driver, the next request finds it deactivated
    DeactivateUser::run(actor($admin), $lene);

    $this->getJson('/api/v1/users')->assertUnauthorized();
});

it('reactivates an account without bringing its old tokens back', function () {
    $admin = User::factory()->admin()->create();
    $user = User::factory()->create();
    $token = apiToken($user, ['read']);
    DeactivateUser::run(actor($admin), $user);

    $this->actingAs($admin)->postJson("/api/v1/users/{$user->id}/reactivate")->assertOk()->assertJsonPath('data.disabled_at', null);

    expect($user->fresh()?->disabled_at)->toBeNull()->and($user->tokens()->count())->toBe(0)
        ->and(Event::query()->where('type', EventType::UserReactivated)->where('subject_id', $user->id)->count())->toBe(1);
    forgetApiAuth();
    $this->withToken($token)->getJson('/api/v1/users')->assertUnauthorized();
});

it('keeps the time of an account that was deactivated before', function () {
    $admin = User::factory()->admin()->create();
    $user = User::factory()->disabled()->create(['disabled_at' => now()->subDay()]);
    $since = $user->disabled_at?->toJSON();

    $this->actingAs($admin)->postJson("/api/v1/users/{$user->id}/deactivate")->assertOk()->assertJsonPath('data.disabled_at', $since);
});

it('records nothing when the account already has the state asked for', function () {
    $admin = User::factory()->admin()->create();
    $user = User::factory()->create();
    $stale = User::query()->findOrFail($user->id);
    $this->actingAs($admin);

    $this->postJson("/api/v1/users/{$user->id}/reactivate")->assertOk()->assertJsonPath('data.disabled_at', null);
    $this->postJson("/api/v1/users/{$user->id}/deactivate")->assertOk();
    $since = $user->fresh()?->disabled_at?->toJSON();
    $this->postJson("/api/v1/users/{$user->id}/deactivate")->assertOk()->assertJsonPath('data.disabled_at', $since);
    expect(DeactivateUser::run(actor($admin), $stale)->disabled_at?->toJSON())->toBe($since);

    ReactivateUser::run(actor($admin), $user);
    expect(ReactivateUser::run(actor($admin), $stale)->disabled_at)->toBeNull()
        ->and(Event::query()->where('subject_id', $user->id)->orderBy('occurred_at')->pluck('type')->all())
        ->toBe([EventType::UserDeactivated, EventType::UserReactivated]);
});

it('lets the account see nothing at once, and everything again after reactivating', function () {
    $admin = User::factory()->admin()->create();
    $web = Project::factory()->public()->create();
    $user = memberOf($web, ProjectRole::Member);
    expect(Visibility::projectIds($user)->all())->toBe([$web->id]);       // kept for the request

    DeactivateUser::run(actor($admin), $user);
    expect(Visibility::projectIds($user)->all())->toBe([]);

    ReactivateUser::run(actor($admin), $user);
    expect(Visibility::projectIds($user)->all())->toBe([$web->id]);
});

it('never deactivates the default bot', function () {
    app()->setLocale('de');
    $bot = User::defaultBot();
    $token = apiToken($bot, ['read']);

    $this->actingAs(User::factory()->admin()->create())->postJson("/api/v1/users/{$bot->id}/deactivate")
        ->assertConflict()->assertJsonPath('reason', 'default_bot')
        ->assertJsonPath('detail', 'Der Standard-Bot lässt sich nicht deaktivieren.');

    expect($bot->fresh()?->disabled_at)->toBeNull()->and($bot->tokens()->count())->toBe(1);
    forgetApiAuth();
    $this->withToken($token)->getJson('/api/v1/users')->assertOk();
});

it('lets only org admins deactivate and reactivate, with the sentences of the clickdummy', function () {
    app()->setLocale('de');
    $member = User::factory()->create();
    $other = User::factory()->create();

    $this->actingAs($member)->postJson("/api/v1/users/{$other->id}/deactivate")
        ->assertForbidden()->assertJsonPath('detail', 'Konten deaktivieren nur Org-Admins.');
    $this->postJson("/api/v1/users/{$other->id}/reactivate")
        ->assertForbidden()->assertJsonPath('detail', 'Konten aktivieren nur Org-Admins.');

    expect($other->fresh()?->disabled_at)->toBeNull();
});

it('answers 404 for an account that does not exist', function () {
    $this->actingAs(User::factory()->admin()->create())->postJson('/api/v1/users/01JAAAAAAAAAAAAAAAAAAAAAAA/deactivate')->assertNotFound();
});
