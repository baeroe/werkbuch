<?php

namespace App\Support;

use Closure;
use Illuminate\Support\Facades\DB;

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
 */
final class ReadCommitted
{
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

        $level = str_replace('-', ' ', (string) DB::scalar('select @@session.transaction_isolation'));
        DB::statement('set session transaction isolation level read committed');

        try {
            return $transaction();
        } finally {
            DB::statement("set session transaction isolation level {$level}");
        }
    }
}
