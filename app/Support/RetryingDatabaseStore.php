<?php

namespace App\Support;

use Closure;
use Illuminate\Cache\DatabaseStore;
use Illuminate\Database\QueryException;
use Throwable;

/**
 * Laravel's cache store `database` (driver `retrying-database`, the store `database` of DDEV and Docker), which tries a
 * statement again that MariaDB rolled back as a deadlock victim (SQLSTATE 40001, error 1213). The throttles count in it:
 * requests of one person at once (a live salvo loads every query of a screen again) write the same key, and once a
 * counter has run out, the first request deletes the expired row and two `insert ignore` of the key both hold a shared
 * lock on the delete-marked record and both wait for the exclusive one: MariaDB rolls one back (1213), which was a 500.
 * Each of these statements is one on its own (an increment one short transaction), so trying it again is safe: an add
 * then finds the row of the other request.
 *
 * Never a lock wait timeout (1205): outside a transaction every attempt waits the full `innodb_lock_wait_timeout`
 * (50 s), three attempts would hold a request for 150 s (A436, changes A433).
 *
 * Only outside a transaction: inside one the deadlock rolled back the whole transaction of the caller, which tries it
 * again itself (`DB::transaction(…, 3)`, the same rule as Laravel's transactions and DatabaseLock). Locks (`lock()`)
 * stay Laravel's: `DatabaseLock::release` and `pruneExpiredLocks` swallow their errors, the `update` in `acquire`,
 * `refresh` and `forceRelease` can throw (only jobs and the scheduler lock).
 */
final class RetryingDatabaseStore extends DatabaseStore
{
    /** The driver of the store in `config/cache.php`, registered in AppServiceProvider. */
    public const DRIVER = 'retrying-database';

    /** Milliseconds to wait before the second and the third attempt; a third failure goes to the caller. */
    public const PAUSES = [10, 50];

    /** True while an attempt runs, so the calls of one operation to another (add reads first) try only once in all. */
    private bool $retrying = false;

    /**
     * @param  array<int, string>  $keys
     * @return array<string, mixed>
     */
    public function many(array $keys)
    {
        return $this->retry(fn () => parent::many($keys));
    }

    /**
     * @param  array<string, mixed>  $values
     */
    public function putMany(array $values, $seconds)
    {
        return $this->retry(fn () => parent::putMany($values, $seconds));
    }

    public function add($key, $value, $seconds)
    {
        return $this->retry(fn () => parent::add($key, $value, $seconds));
    }

    protected function incrementOrDecrement($key, $value, Closure $callback)
    {
        return $this->retry(fn () => parent::incrementOrDecrement($key, $value, $callback));
    }

    public function touch($key, $seconds)
    {
        return $this->retry(fn () => parent::touch($key, $seconds));
    }

    /**
     * @param  array<int, string>  $keys
     */
    protected function forgetMany(array $keys)
    {
        return $this->retry(fn () => parent::forgetMany($keys));
    }

    /**
     * @param  array<int, string>  $keys
     */
    protected function forgetManyIfExpired(array $keys, bool $prefixed = false)
    {
        return $this->retry(fn () => parent::forgetManyIfExpired($keys, $prefixed));
    }

    /**
     * @template T
     *
     * @param  Closure(): T  $statement
     * @return T
     */
    private function retry(Closure $statement): mixed
    {
        if ($this->retrying || $this->getConnection()->transactionLevel() > 0) {
            return $statement();
        }

        $this->retrying = true;

        try {
            return retry(self::PAUSES, $statement, 0, self::isDeadlock(...));
        } finally {
            $this->retrying = false;
        }
    }

    /** A deadlock victim: SQLSTATE 40001 or MariaDB error 1213 (a lock wait timeout, 1205, is none). */
    private static function isDeadlock(Throwable $e): bool
    {
        if (! $e instanceof QueryException) {
            return false;
        }

        return ($e->errorInfo[1] ?? null) === 1213 || ($e->errorInfo[0] ?? null) === '40001';
    }
}
