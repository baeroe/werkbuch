<?php

namespace Tests\Support;

use App\Exceptions\Problem;
use Closure;
use Illuminate\Database\QueryException;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\ValidationException;

/**
 * The one place for the two-connection tests (tests/Integration, without the test transaction of RefreshDatabase).
 * `mariadb` holds its transaction open like a request in progress (`hold()`, `release()`), `mariadb_second` is the
 * other request (`second()`) and gives up waiting for a lock after one second instead of reading what it saw before.
 * Call `setUp()` in `beforeEach` and `tearDown()` in `afterEach`.
 */
final class RaceConnections
{
    /** A copy of `mariadb` as `mariadb_second`, with a lock wait of one second. */
    public static function setUp(): void
    {
        config(['database.connections.mariadb_second' => config('database.connections.mariadb')]);
        DB::connection('mariadb_second')->statement('SET innodb_lock_wait_timeout = 1');
    }

    /** Rolls back the transaction `hold()` left open (a test that failed before `release()`), then purges the copy. */
    public static function tearDown(): void
    {
        $first = DB::connection('mariadb');

        if ($first->transactionLevel() > 0) {
            $first->rollBack();
        }

        DB::setDefaultConnection('mariadb');
        DB::purge('mariadb_second');
    }

    /** Opens a transaction on `mariadb` and runs the call in it; the transaction stays open until `release()`. */
    public static function hold(Closure $first): mixed
    {
        DB::connection('mariadb')->beginTransaction();

        return $first();
    }

    /** Commits the transaction `hold()` opened. */
    public static function release(): void
    {
        DB::connection('mariadb')->commit();
    }

    /**
     * Commits the transaction `hold()` opened at the moment `mariadb_second` asks for the lock on a row of the table
     * (`select * from <table> … for update`), once: the first request finishes while the second one is on its way, after
     * what it read before the lock and before the lock itself. Whatever the second one checked before its lock missed
     * what the first one wrote; whatever it checks under its lock sees it. The commit runs with `mariadb` as the default
     * connection, so the work of the first request after its commit (the outbox dispatching its events) stays on its
     * own connection instead of running on the second one in the middle of its statement.
     */
    public static function releaseBeforeLock(string $table): void
    {
        $released = false;

        DB::connection('mariadb_second')->beforeExecuting(function (string $query) use ($table, &$released): void {
            if (! $released && str_starts_with($query, "select * from `{$table}`") && str_ends_with($query, 'for update')) {
                $released = true;
                $default = DB::getDefaultConnection();
                DB::setDefaultConnection('mariadb');

                try {
                    self::release();
                } finally {
                    DB::setDefaultConnection($default);
                }
            }
        });
    }

    /**
     * Runs the call on `mariadb_second` (the default connection again afterwards). The result is what the call returns,
     * or the QueryException, ValidationException or Problem that ended it.
     */
    public static function second(Closure $call): mixed
    {
        DB::setDefaultConnection('mariadb_second');

        try {
            return $call();
        } catch (QueryException|ValidationException|Problem $exception) {
            return $exception;
        } finally {
            DB::setDefaultConnection('mariadb');
        }
    }

    /**
     * The outcome is the QueryException of a lock that did not come: `select * from <table> … for update`, or, for a
     * statement of another shape, one that starts with `$sqlStart` and ends on `for update`.
     */
    public static function expectLockWait(mixed $outcome, string $table, ?string $sqlStart = null): void
    {
        expect($outcome)->toBeInstanceOf(QueryException::class);
        assert($outcome instanceof QueryException);
        expect($outcome->getMessage())->toContain('Lock wait timeout')
            ->and($outcome->getSql())->toStartWith($sqlStart ?? "select * from `{$table}`")->toEndWith('for update');
    }
}
