<?php

namespace App\Jobs;

use App\Actions\AgentRuns\PruneRunEvents;
use App\Models\User;
use App\Support\Actor;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Foundation\Queue\Queueable;
use Illuminate\Queue\Middleware\WithoutOverlapping;

/**
 * Tidies up the logs of runs (spec 7.5): lines older than 30 days, as the default bot, every hour on the default queue
 * (routes/console.php); the middleware keeps two from running at once (a second run is dropped).
 */
final class PruneRunEventsJob implements ShouldQueue
{
    use Queueable;

    /**
     * @return list<object>
     */
    public function middleware(): array
    {
        return [(new WithoutOverlapping('prune-run-events'))->dontRelease()->expireAfter(3600)];
    }

    public function handle(): void
    {
        PruneRunEvents::run(Actor::system(User::defaultBot(), 'prune_runs'));
    }
}
