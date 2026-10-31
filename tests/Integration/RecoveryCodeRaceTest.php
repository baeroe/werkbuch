<?php

use App\Actions\Account\RegenerateRecoveryCodes;
use App\Actions\Auth\PassTwoFactorChallenge;
use App\Models\User;
use Laravel\Fortify\Actions\EnableTwoFactorAuthentication;
use Tests\Support\RaceConnections;

/*
 * A recovery code works for one sign-in, also when two requests bring it at the same time. Two connections to the same
 * database, without the test transaction: `mariadb` holds its transaction open like a sign-in in progress,
 * `mariadb_second` is the other request, which gives up waiting for the lock after one second.
 */

beforeEach(fn () => RaceConnections::setUp());

afterEach(fn () => RaceConnections::tearDown());

/** Mara with her second factor on; both requests loaded her before either used a code (a stale list each). */
$maraForTheRace = function (): User {
    $mara = User::factory()->create();
    app(EnableTwoFactorAuthentication::class)($mara, true);
    $mara->forceFill(['two_factor_confirmed_at' => now()])->save();

    return $mara;
};

it('signs in only once with the same recovery code brought twice at the same time', function () use ($maraForTheRace) {
    $mara = $maraForTheRace();
    $code = $mara->recoveryCodes()[0];
    $second = User::query()->findOrFail($mara->id);

    // connection 1: the first sign-in uses the code and has not committed yet
    expect(RaceConnections::hold(fn () => PassTwoFactorChallenge::run($mara, null, $code)))->toBeTrue();

    // connection 2: the second sign-in with the same code has to wait for the row, it does not trust its own copy
    RaceConnections::expectLockWait(RaceConnections::second(fn () => PassTwoFactorChallenge::run($second, null, $code)), 'users');

    RaceConnections::release();

    // once the first is done, the second reads the row afresh: the code is gone
    expect(RaceConnections::second(fn () => PassTwoFactorChallenge::run($second, null, $code)))->toBeFalse()
        ->and(User::query()->findOrFail($mara->id)->recoveryCodes())->toHaveCount(7)->not->toContain($code);
});

it('keeps both codes used when two different codes are brought at the same time', function () use ($maraForTheRace) {
    $mara = $maraForTheRace();
    [$first, $other] = $mara->recoveryCodes();
    $second = User::query()->findOrFail($mara->id);

    RaceConnections::hold(fn () => PassTwoFactorChallenge::run($mara, null, $first));
    RaceConnections::release();

    // the second request still holds the list with both codes; it reads the row again and writes only its own change
    expect(RaceConnections::second(fn () => PassTwoFactorChallenge::run($second, null, $other)))->toBeTrue()
        ->and(User::query()->findOrFail($mara->id)->recoveryCodes())->toHaveCount(6)->not->toContain($first)->not->toContain($other);
});

it('lets no sign-in write the old codes back over new ones', function () use ($maraForTheRace) {
    $mara = $maraForTheRace();
    $old = $mara->recoveryCodes();
    $signIn = User::query()->findOrFail($mara->id);

    // new codes are made and not yet committed; a sign-in with an old code meanwhile waits for them
    $new = RaceConnections::hold(fn () => RegenerateRecoveryCodes::run(actor($mara)))['recovery_codes'];
    RaceConnections::expectLockWait(RaceConnections::second(fn () => PassTwoFactorChallenge::run($signIn, null, $old[0])), 'users');
    RaceConnections::release();

    expect(RaceConnections::second(fn () => PassTwoFactorChallenge::run($signIn, null, $old[0])))->toBeFalse()
        ->and(User::query()->findOrFail($mara->id)->recoveryCodes())->toBe($new);
});
