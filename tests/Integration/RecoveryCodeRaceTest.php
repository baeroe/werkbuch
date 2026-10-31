<?php

use App\Actions\Account\RegenerateRecoveryCodes;
use App\Actions\Auth\PassTwoFactorChallenge;
use App\Models\User;
use Illuminate\Database\QueryException;
use Illuminate\Support\Facades\DB;
use Laravel\Fortify\Actions\EnableTwoFactorAuthentication;

/*
 * A recovery code works for one sign-in, also when two requests bring it at the same time. Two connections to the same
 * database, without the test transaction: `mariadb` holds its transaction open like a sign-in in progress,
 * `mariadb_second` is the other request, which gives up waiting for the lock after one second.
 */

beforeEach(function () {
    config(['database.connections.mariadb_second' => config('database.connections.mariadb')]);
    DB::connection('mariadb_second')->statement('SET innodb_lock_wait_timeout = 1');
});

afterEach(function () {
    DB::setDefaultConnection('mariadb');
    DB::purge('mariadb_second');
});

/** Mara with her second factor on; both requests loaded her before either used a code (a stale list each). */
function maraForTheRace(): User
{
    $mara = User::factory()->create();
    app(EnableTwoFactorAuthentication::class)($mara, true);
    $mara->forceFill(['two_factor_confirmed_at' => now()])->save();

    return $mara;
}

/** Runs the call on the second connection; the QueryException of a lock it waited for in vain, else null. */
function onSecondConnection(Closure $call): mixed
{
    DB::setDefaultConnection('mariadb_second');

    try {
        return $call();
    } catch (QueryException $exception) {
        return $exception;
    } finally {
        DB::setDefaultConnection('mariadb');
    }
}

it('signs in only once with the same recovery code brought twice at the same time', function () {
    $mara = maraForTheRace();
    $code = $mara->recoveryCodes()[0];
    $second = User::query()->findOrFail($mara->id);

    // connection 1: the first sign-in uses the code and has not committed yet
    DB::connection('mariadb')->beginTransaction();
    expect(PassTwoFactorChallenge::run($mara, null, $code))->toBeTrue();

    // connection 2: the second sign-in with the same code has to wait for the row, it does not trust its own copy
    $timeout = onSecondConnection(fn () => PassTwoFactorChallenge::run($second, null, $code));
    expect($timeout)->toBeInstanceOf(QueryException::class)
        ->and($timeout->getMessage())->toContain('Lock wait timeout')
        ->and($timeout->getSql())->toEndWith('for update');

    DB::connection('mariadb')->commit();

    // once the first is done, the second reads the row afresh: the code is gone
    expect(onSecondConnection(fn () => PassTwoFactorChallenge::run($second, null, $code)))->toBeFalse()
        ->and(User::query()->findOrFail($mara->id)->recoveryCodes())->toHaveCount(7)->not->toContain($code);
});

it('keeps both codes used when two different codes are brought at the same time', function () {
    $mara = maraForTheRace();
    [$first, $other] = $mara->recoveryCodes();
    $second = User::query()->findOrFail($mara->id);

    DB::connection('mariadb')->beginTransaction();
    PassTwoFactorChallenge::run($mara, null, $first);
    DB::connection('mariadb')->commit();

    // the second request still holds the list with both codes; it reads the row again and writes only its own change
    expect(onSecondConnection(fn () => PassTwoFactorChallenge::run($second, null, $other)))->toBeTrue()
        ->and(User::query()->findOrFail($mara->id)->recoveryCodes())->toHaveCount(6)->not->toContain($first)->not->toContain($other);
});

it('lets no sign-in write the old codes back over new ones', function () {
    $mara = maraForTheRace();
    $old = $mara->recoveryCodes();
    $signIn = User::query()->findOrFail($mara->id);

    // new codes are made and not yet committed; a sign-in with an old code meanwhile waits for them
    DB::connection('mariadb')->beginTransaction();
    $new = RegenerateRecoveryCodes::run(actor($mara))['recovery_codes'];
    expect(onSecondConnection(fn () => PassTwoFactorChallenge::run($signIn, null, $old[0])))->toBeInstanceOf(QueryException::class);
    DB::connection('mariadb')->commit();

    expect(onSecondConnection(fn () => PassTwoFactorChallenge::run($signIn, null, $old[0])))->toBeFalse()
        ->and(User::query()->findOrFail($mara->id)->recoveryCodes())->toBe($new);
});
