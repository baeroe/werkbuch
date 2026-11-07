<?php

use App\Models\User;
use App\Support\RetryingDatabaseStore;
use Illuminate\Cache\RateLimiter;
use Illuminate\Cache\Repository;
use Illuminate\Database\Connection;
use Illuminate\Database\QueryException;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Sleep;
use Tests\Support\RaceConnections;

/*
 * The cache store `database` (DDEV, Docker) keeps the counters of every throttle. Requests of one person at once (a live
 * salvo loads every query of a screen again) write the same key: when the counter has run out, the first one deletes
 * the expired row, and two `insert ignore` of the key then both hold a shared lock on the delete-marked record and both
 * wait for the exclusive one, so MariaDB rolls one back (1213). Outside a transaction a statement of the cache is tried
 * again; inside one the deadlock rolled back the whole transaction, so it goes to the transaction. Without the test
 * transaction of the feature tests (the store would always be inside one), so in Integration.
 */

beforeEach(function () {
    RaceConnections::setUp();
    Sleep::fake();
});

afterEach(function () {
    RaceConnections::tearDown();
});

/** A PDOException as the driver builds it: the message and the errorInfo of the server. */
$driverError = function (string $state, int $code, string $message): PDOException {
    $error = new PDOException("SQLSTATE[{$state}]: {$message}");
    $error->errorInfo = [$state, $code, $message];

    return $error;
};

/**
 * Makes the first statement of the connection that starts with `$sqlStart` fail like a deadlock MariaDB reports, before
 * it runs; answers how often it did.
 *
 * @return Closure(): int
 */
$deadlockOnce = function (string $sqlStart, string $connection = 'mariadb') use ($driverError): Closure {
    $thrown = 0;
    DB::connection($connection)->beforeExecuting(function (string $query, array $bindings, Connection $on) use ($sqlStart, &$thrown, $driverError): void {
        if ($thrown === 0 && str_starts_with($query, $sqlStart)) {
            $thrown++;
            throw new QueryException($on->getName() ?? '', $query, $bindings, $driverError('40001', 1213, 'Deadlock found when trying to get lock; try restarting transaction'));
        }
    });

    return function () use (&$thrown): int {
        return $thrown;
    };
};

$store = fn (): Repository => Cache::store('database');

it('tries a statement of the cache again that MariaDB rolled back as the deadlock victim', function (string $sqlStart, Closure $write, mixed $value) use ($deadlockOnce, $store) {
    $store()->put('counter', 1, 60);
    $thrown = $deadlockOnce($sqlStart);

    $write($store());

    expect($thrown())->toBe(1)
        ->and($store()->get('counter'))->toBe($value);
    Sleep::assertSleptTimes(1);
})->with([
    'add' => ['insert ignore into `cache`', function (Repository $cache) {
        expect($cache->add('other', 5, 60))->toBeTrue();
        expect($cache->get('other'))->toBe(5);
    }, 1],
    'increment' => ['select * from `cache`', fn (Repository $cache) => expect($cache->increment('counter'))->toBe(2), 2],
    'put' => ['insert into `cache`', fn (Repository $cache) => $cache->put('counter', 7, 60), 7],
    'forget' => ['delete from `cache`', fn (Repository $cache) => $cache->forget('counter'), null],
    'touch' => ['update `cache`', fn (Repository $cache) => expect($cache->touch('counter', 120))->toBeTrue(), 1],
]);

it('reads an expired key again whose delete was the deadlock victim', function () use ($deadlockOnce, $store) {
    $store()->put('counter', 1, 60);
    $this->travel(2)->minutes();
    $thrown = $deadlockOnce('delete from `cache`');

    expect($store()->get('counter'))->toBeNull()
        ->and($thrown())->toBe(1)
        ->and(DB::table('cache')->count())->toBe(0);
});

it('gives up after the third deadlock in a row', function () use ($store, $driverError) {
    $thrown = 0;
    DB::connection()->beforeExecuting(function (string $query, array $bindings) use (&$thrown, $driverError): void {
        if (str_starts_with($query, 'insert ignore into `cache`')) {
            $thrown++;
            throw new QueryException('mariadb', $query, $bindings, $driverError('40001', 1213, 'Deadlock found when trying to get lock; try restarting transaction'));
        }
    });

    expect(fn () => $store()->add('counter', 0, 60))->toThrow(QueryException::class, 'Deadlock found');
    expect($thrown)->toBe(3);
});

it('leaves any other error of the database to the caller', function () use ($store, $driverError) {
    $thrown = 0;
    DB::connection()->beforeExecuting(function (string $query, array $bindings) use (&$thrown, $driverError): void {
        if (str_starts_with($query, 'insert ignore into `cache`')) {
            $thrown++;
            throw new QueryException('mariadb', $query, $bindings, $driverError('42S02', 1146, "Table 'testing.cache' doesn't exist"));
        }
    });

    expect(fn () => $store()->add('counter', 0, 60))->toThrow(QueryException::class, "doesn't exist");
    expect($thrown)->toBe(1);
});

it('leaves an error that is no database error to the caller', function () use ($store) {
    $thrown = 0;
    DB::connection()->beforeExecuting(function (string $query) use (&$thrown): void {
        if (str_starts_with($query, 'insert ignore into `cache`')) {
            $thrown++;
            throw new RuntimeException('connection lost');
        }
    });

    expect(fn () => $store()->add('counter', 0, 60))->toThrow(RuntimeException::class, 'connection lost');
    expect($thrown)->toBe(1);
});

it('leaves a deadlock inside a transaction to the transaction', function () use ($deadlockOnce, $store) {
    $thrown = $deadlockOnce('insert ignore into `cache`');

    expect(fn () => DB::transaction(fn () => $store()->add('counter', 0, 60)))->toThrow(QueryException::class, 'Deadlock found');
    expect($thrown())->toBe(1)
        ->and(DB::table('cache')->count())->toBe(0);
    Sleep::assertNeverSlept();
});

it('passes a lock wait timeout through at once', function () {
    config(['cache.stores.database.connection' => 'mariadb_second']);
    $cache = Cache::store('database');
    $prefixed = $cache->getStore()->getPrefix().'counter';
    // the other request has written the counter and not committed yet: the add waits for its lock until MariaDB gives up
    RaceConnections::hold(fn () => DB::table('cache')->insert(['key' => $prefixed, 'value' => 'i:3;', 'expiration' => now()->addMinute()->timestamp]));
    $attempts = 0;
    DB::connection('mariadb_second')->beforeExecuting(function (string $query) use (&$attempts): void {
        if (str_starts_with($query, 'insert ignore into `cache`')) {
            $attempts++;
        }
    });

    $outcome = RaceConnections::second(fn () => $cache->add('counter', 0, 60));

    expect($outcome)->toBeInstanceOf(QueryException::class)
        ->and($outcome->getMessage())->toContain('Lock wait timeout');
    expect($attempts)->toBe(1);
    Sleep::assertNeverSlept();
});

it('retries a deadlock on the update of increment', function () use ($deadlockOnce, $store) {
    $store()->put('counter', 1, 60);
    $thrown = $deadlockOnce('update `cache`');

    expect($store()->increment('counter'))->toBe(2)
        ->and($thrown())->toBe(1)
        ->and($store()->get('counter'))->toBe(2);
    Sleep::assertSleptTimes(1);
});

it('uses the retrying store for the rate limiter of the app', function () {
    config(['cache.default' => 'database']);
    app()->forgetInstance(RateLimiter::class);
    $limiter = app(RateLimiter::class);
    $cache = (new ReflectionProperty(RateLimiter::class, 'cache'))->getValue($limiter);

    expect($cache->getStore())->toBeInstanceOf(RetryingDatabaseStore::class);
});

it('answers the API although the counter of its throttle deadlocked once', function () use ($deadlockOnce) {
    // the throttle counts in the store `database`, as in DDEV and Docker (the tests otherwise count in `array`)
    $limiter = new RateLimiter(Cache::store('database'));
    $limiter->for('api', app(RateLimiter::class)->limiter('api'));
    app()->instance(RateLimiter::class, $limiter);
    $token = apiToken(User::factory()->create(), ['read']);
    $thrown = $deadlockOnce('insert ignore into `cache`');

    $this->getJson('/api/v1/notifications?per_page=1&filter[unread]=1', ['Authorization' => "Bearer {$token}"])
        ->assertOk()
        ->assertHeader('X-RateLimit-Remaining', 599);

    expect($thrown())->toBe(1);
});
