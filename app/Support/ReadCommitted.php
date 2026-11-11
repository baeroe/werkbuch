<?php

namespace App\Support;

use Closure;
use Illuminate\Database\Events\ConnectionEstablished;
use Illuminate\Support\Facades\DB;
use Throwable;

/**
 * Runs a transaction in READ COMMITTED (N1): a deletion that hands attachments over locks their rows `for update` and
 * reads the texts that name them afterwards. Under REPEATABLE READ its snapshot would be as old as its first plain read
 * (the eager loads before the lock), and a text that named an attachment and committed while the deletion waited would
 * be missed (T13-M8). Under READ COMMITTED every plain read sees what committed last, without locking a text.
 *
 * The level is the session's for the transaction the callback opens (and its retries after a deadlock, which begin
 * anew) and goes back afterwards. Locking reads stay as they are; READ COMMITTED takes no gap locks, which these
 * actions do not lean on: every write that could meet them locks the item's row (ItemLock, the parent's shared lock).
 * Inside a transaction that is already open (a caller's, the one of a feature test) the level of that one holds:
 * MariaDB changes no level mid-transaction.
 *
 * A new session starts at the server's level. Laravel connects anew inside the caller's BEGIN when the connection is
 * gone and begins at once (K4), so run cannot look in between: while a run is open on a connection, established()
 * (a listener on ConnectionEstablished, AppServiceProvider) sets the level on the new session again. When setting the
 * level back fails after the transaction failed, the error of the transaction comes out and the failed reset is
 * reported; either way the session it failed on is dropped, so the next query gets a new one at the server's level.
 */
final class ReadCommitted
{
    private const SET = 'set session transaction isolation level read committed';

    /** @var array<string, int> the open runs by name of their connection */
    private static array $open = [];

    /**
     * @template T
     *
     * @param  Closure(): T  $transaction  opens its DB::transaction itself
     * @return T
     */
    public static function run(Closure $transaction): mixed
    {
        if (DB::transactionLevel() > 0) {
            return $transaction();
        }

        $name = DB::getDefaultConnection();
        $level = str_replace('-', ' ', (string) DB::scalar('select @@session.transaction_isolation'));
        DB::statement(self::SET);
        self::$open[$name] = (self::$open[$name] ?? 0) + 1;

        $failure = null;
        try {
            return $transaction();
        } catch (Throwable $e) {
            $failure = $e;

            throw $e;
        } finally {
            if (--self::$open[$name] === 0) {
                unset(self::$open[$name]);
            }
            try {
                DB::statement("set session transaction isolation level {$level}");
            } catch (Throwable $reset) {
                // the session may still live at READ COMMITTED: a long-lived worker would keep it for every job after;
                // a new one starts at the server's level (5b-M1)
                DB::disconnect($name);
                if ($failure === null) {
                    throw $reset;
                }
                report($reset);
            }
        }
    }

    /**
     * Sets the level on a session a connection made while a run of it is open (a reconnect before the BEGIN). A failure
     * here is reported and never thrown out of the listener (5b-M2): it would break whatever connected, a BEGIN or a
     * query. The transaction then runs at the server's level (REPEATABLE READ) and this one run loses what READ
     * COMMITTED gives it (T13-M8): a hand-over of attachments can miss a text that committed after its lock. Setting
     * a session level needs no privilege, and a dead connection fails its BEGIN as well, so the case is hardly reachable.
     */
    public static function established(ConnectionEstablished $event): void
    {
        if (isset(self::$open[$event->connectionName])) {
            try {
                $event->connection->statement(self::SET);
            } catch (Throwable $failure) {
                report($failure);
            }
        }
    }
}
