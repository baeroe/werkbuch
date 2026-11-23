<?php

namespace App\Actions\GitHub;

use App\Models\GitHubDelivery;
use App\Support\Actor;
use Lorisleiva\Actions\Concerns\AsAction;

/**
 * Forgets webhook deliveries older than `KEEP_DAYS` (hourly, like the deliveries of werkbuch's own webhooks): GitHub
 * redelivers only within days, the dedupe needs no more. No event.
 */
final class PruneGitHubDeliveries
{
    use AsAction;

    public const KEEP_DAYS = 30;

    public const BLOCK = 1000;

    public function handle(Actor $actor): int
    {
        $pruned = 0;
        do {
            $ids = GitHubDelivery::query()->where('received_at', '<', now()->subDays(self::KEEP_DAYS))
                ->orderBy('id')->limit(self::BLOCK)->pluck('id');
            $pruned += GitHubDelivery::query()->whereKey($ids)->delete();
        } while ($ids->count() === self::BLOCK);

        return $pruned;
    }
}
