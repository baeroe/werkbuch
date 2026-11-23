<?php

namespace App\Actions\AgentRuns;

use App\Domain\Agents\Protocol;
use App\Models\AgentRunEvent;
use App\Support\Actor;
use Lorisleiva\Actions\Concerns\AsAction;

/**
 * Tidies up the logs of runs (every hour, spec 7.5): lines older than 30 days go, in blocks. No event.
 */
final class PruneRunEvents
{
    use AsAction;

    public const BLOCK = 1000;

    /** How many lines went. */
    public function handle(Actor $actor): int
    {
        $cutoff = now()->subDays(Protocol::EVENTS_KEEP_DAYS);
        $total = 0;

        do {
            $ids = AgentRunEvent::query()->where('at', '<', $cutoff)->orderBy('id')->limit(self::BLOCK)->pluck('id');
            $total += $ids->isEmpty() ? 0 : AgentRunEvent::query()->whereKey($ids)->delete();
        } while ($ids->count() === self::BLOCK);

        return $total;
    }
}
