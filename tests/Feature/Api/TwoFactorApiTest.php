<?php

use App\Actions\Account\GetTwoFactor;
use App\Events\EventType;
use App\Exceptions\Problem;
use App\Models\Event;
use App\Models\User;
use Laravel\Fortify\Actions\EnableTwoFactorAuthentication;
use PragmaRX\Google2FA\Google2FA;

/*
 * Two-factor sign-in from the personal settings (spec 4.2, P6, P19): set up in two steps (the secret, then the first
 * code), off again, new recovery codes; only people, only from the session of the interface.
 */

/** A person whose two-factor sign-in is on; the secret is Fortify's, the recovery codes eight new ones. */
function personWithTwoFactor(): User
{
    $user = User::factory()->create();
    app(EnableTwoFactorAuthentication::class)($user, true);
    $user->forceFill(['two_factor_confirmed_at' => now()])->save();

    return $user;
}

it('sets up two-factor sign-in in two steps and hands out the recovery codes once', function () {
    $lene = User::factory()->create();
    $this->actingAs($lene);
    $setup = $this->postJson('/api/v1/me/two-factor')->assertOk()->json();
    expect($setup['qr_svg'])->toStartWith('data:image/svg+xml;base64,')->and($setup['otpauth_url'])->toContain('otpauth://totp/');

    $this->postJson('/api/v1/me/two-factor/confirm', ['code' => '000000'])->assertUnprocessable()->assertJsonValidationErrors(['code']);
    $code = app(Google2FA::class)->getCurrentOtp($setup['secret']);
    $codes = $this->postJson('/api/v1/me/two-factor/confirm', ['code' => $code])->assertOk()->json('recovery_codes');

    expect($codes)->toHaveCount(8)
        ->and($this->getJson('/api/v1/me/two-factor')->json())->toMatchArray(['enabled' => true, 'recovery_codes_left' => 8])
        ->and(Event::query()->where('type', 'user.two_factor_enabled')->count())->toBe(1);
});

it('names the state of the second factor', function () {
    $this->freezeSecond();
    $lene = User::factory()->create();

    $this->actingAs($lene)->getJson('/api/v1/me/two-factor')->assertOk()
        ->assertExactJson(['enabled' => false, 'confirmed_at' => null, 'recovery_codes_left' => 0]);

    // a setup that was started but not confirmed is still off
    $this->postJson('/api/v1/me/two-factor')->assertOk();
    $this->getJson('/api/v1/me/two-factor')->assertExactJson(['enabled' => false, 'confirmed_at' => null, 'recovery_codes_left' => 0]);

    $lene->forceFill(['two_factor_confirmed_at' => now()])->save();
    $this->getJson('/api/v1/me/two-factor')->assertExactJson(['enabled' => true, 'confirmed_at' => now()->toJSON(), 'recovery_codes_left' => 8]);
});

it('starts a setup anew with a new secret, and notes the start without the secret and without a webhook', function () {
    $lene = User::factory()->create();
    $this->actingAs($lene);

    $first = $this->postJson('/api/v1/me/two-factor')->assertOk()->json('secret');
    $second = $this->postJson('/api/v1/me/two-factor')->assertOk()->json('secret');

    $events = Event::query()->where('type', EventType::UserTwoFactorSetupStarted)->get();
    expect($second)->not->toBe($first)
        ->and(decrypt((string) $lene->fresh()?->two_factor_secret))->toBe($second)
        ->and($events)->toHaveCount(2)
        ->and($events->first()?->actor_id)->toBe($lene->id)
        ->and($events->first()?->subject_id)->toBe($lene->id)
        ->and($events->first()?->changes)->toBeNull()
        ->and(EventType::UserTwoFactorSetupStarted->webhook())->toBeFalse();
});

it('refuses a second setup while two-factor sign-in is on', function () {
    $lene = personWithTwoFactor();
    $secret = $lene->two_factor_secret;

    $this->actingAs($lene)->postJson('/api/v1/me/two-factor')->assertConflict()->assertJsonPath('reason', 'two_factor_enabled');

    expect($lene->fresh()?->two_factor_secret)->toBe($secret);
});

it('refuses to confirm without a setup, and a setup that is on already', function (Closure $account) {
    $this->actingAs($account())->postJson('/api/v1/me/two-factor/confirm', ['code' => '123456'])
        ->assertConflict()->assertJsonPath('reason', 'two_factor_not_pending');
})->with([
    'without a setup' => [fn () => User::factory()->create()],
    'on already' => [fn () => personWithTwoFactor()],
]);

it('names a wrong, an empty and a malformed code at the field and keeps the setup open', function (mixed $code) {
    app()->setLocale('de');
    $lene = User::factory()->create();
    $this->actingAs($lene)->postJson('/api/v1/me/two-factor')->assertOk();

    $this->postJson('/api/v1/me/two-factor/confirm', ['code' => $code])->assertUnprocessable()
        ->assertJsonPath('errors.code', ['Der Code stimmt nicht. Nimm den aktuellen aus der App.']);

    expect($lene->fresh()?->two_factor_confirmed_at)->toBeNull()
        ->and(Event::query()->where('type', EventType::UserTwoFactorEnabled)->exists())->toBeFalse();
})->with(['wrong' => '000000', 'empty' => '', 'a list' => [['123456']]]);

it('limits the confirmation to six tries a minute', function () {
    $this->actingAs(User::factory()->create())->postJson('/api/v1/me/two-factor')->assertOk();

    foreach (range(1, 6) as $i) {
        $this->postJson('/api/v1/me/two-factor/confirm', ['code' => '000000'])->assertUnprocessable();
    }

    $this->postJson('/api/v1/me/two-factor/confirm', ['code' => '000000'])->assertTooManyRequests();
});

it('turns two-factor sign-in off, and does nothing when it is off', function () {
    $lene = personWithTwoFactor();

    $this->actingAs($lene)->deleteJson('/api/v1/me/two-factor')->assertNoContent();
    $this->deleteJson('/api/v1/me/two-factor')->assertNoContent();

    $fresh = $lene->fresh();
    expect([$fresh?->two_factor_secret, $fresh?->two_factor_recovery_codes, $fresh?->two_factor_confirmed_at])->toBe([null, null, null])
        ->and(Event::query()->where('type', EventType::UserTwoFactorDisabled)->where('subject_id', $lene->id)->count())->toBe(1);
});

it('drops a setup that was started but not confirmed', function () {
    $lene = User::factory()->create();
    $this->actingAs($lene)->postJson('/api/v1/me/two-factor')->assertOk();

    $this->deleteJson('/api/v1/me/two-factor')->assertNoContent();

    expect($lene->fresh()?->two_factor_secret)->toBeNull()
        ->and(Event::query()->where('type', EventType::UserTwoFactorDisabled)->count())->toBe(1);
});

it('makes eight new recovery codes, and the old ones stop working', function () {
    $lene = personWithTwoFactor();
    $old = $lene->recoveryCodes();

    $codes = $this->actingAs($lene)->postJson('/api/v1/me/two-factor/recovery-codes')->assertOk()->json('recovery_codes');

    expect($codes)->toHaveCount(8)
        ->and(array_intersect($codes, $old))->toBe([])
        ->and($lene->fresh()?->recoveryCodes())->toBe($codes)
        ->and(Event::query()->where('type', EventType::UserRecoveryCodesRegenerated)->where('actor_id', $lene->id)->count())->toBe(1);
});

it('refuses new recovery codes while two-factor sign-in is off', function () {
    $this->actingAs(User::factory()->create())->postJson('/api/v1/me/two-factor/recovery-codes')
        ->assertConflict()->assertJsonPath('reason', 'two_factor_disabled');
});

it('keeps the secret and the codes out of every event', function () {
    $lene = User::factory()->create();
    $this->actingAs($lene);
    $secret = $this->postJson('/api/v1/me/two-factor')->json('secret');
    $codes = $this->postJson('/api/v1/me/two-factor/confirm', ['code' => app(Google2FA::class)->getCurrentOtp($secret)])->json('recovery_codes');
    $newCodes = $this->postJson('/api/v1/me/two-factor/recovery-codes')->json('recovery_codes');
    $this->deleteJson('/api/v1/me/two-factor');

    $stored = Event::query()->where('subject_id', $lene->id)->get()->map(fn (Event $event) => json_encode([$event->changes, $event->meta]))->implode("\n");
    expect(Event::query()->where('subject_id', $lene->id)->pluck('type')->map->value->all())->toBe([
        'user.two_factor_setup_started', 'user.two_factor_enabled', 'user.recovery_codes_regenerated', 'user.two_factor_disabled',
    ]);
    foreach ([$secret, ...$codes, ...$newCodes] as $value) {
        expect($stored)->not->toContain($value);
    }
});

it('only works from the session: every token gets session_required, also one of a bot', function (string $method, string $uri, Closure $account) {
    $token = apiToken($account(), ['read', 'write', 'mcp']);

    $this->withToken($token)->json($method, $uri)->assertForbidden()->assertJsonPath('reason', 'session_required')
        ->assertJsonPath('detail', __('problem.reason.session_required'));
})->with([
    'state' => ['GET', '/api/v1/me/two-factor'],
    'set up' => ['POST', '/api/v1/me/two-factor'],
    'confirm' => ['POST', '/api/v1/me/two-factor/confirm'],
    'turn off' => ['DELETE', '/api/v1/me/two-factor'],
    'new codes' => ['POST', '/api/v1/me/two-factor/recovery-codes'],
    'password' => ['PUT', '/api/v1/me/password'],
])->with([
    'a person' => [fn () => User::factory()->create()],
    'a bot' => [fn () => User::factory()->bot()->create()],
]);

it('is only for people', function () {
    expect(fn () => GetTwoFactor::run(actor(User::factory()->bot()->create())))
        ->toThrow(fn (Problem $problem) => expect([$problem->status, $problem->detail])->toBe([403, __('problem.detail.people_only')]));
});
