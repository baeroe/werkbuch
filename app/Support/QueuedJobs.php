<?php

namespace App\Support;

use Illuminate\Database\Query\Builder;
use Illuminate\Support\Facades\DB;

/**
 * The jobs of the database queue that no worker holds: never reserved, or reserved longer ago than `retry_after` (its
 * worker is gone, the next one takes it again). The one reading for the system page and for the pruning of webhook
 * deliveries (T10-M2).
 */
final class QueuedJobs
{
    public static function free(): Builder
    {
        $expired = now()->getTimestamp() - (int) config('queue.connections.database.retry_after');

        return DB::connection(config('queue.connections.database.connection'))
            ->table(config('queue.connections.database.table'))
            ->where(fn (Builder $free) => $free->whereNull('reserved_at')->orWhere('reserved_at', '<=', $expired));
    }

    /**
     * Whether the queue holds a free job that is due: a backlog no worker works off right now.
     */
    public static function backlog(string $queue): bool
    {
        return self::free()->where('queue', $queue)->where('available_at', '<=', now()->getTimestamp())->exists();
    }
}
