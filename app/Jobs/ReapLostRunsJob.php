<?php

namespace App\Jobs;

use App\Actions\AgentRuns\ReapLostRuns;
use App\Models\User;
use App\Support\Actor;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Foundation\Queue\Queueable;
use Illuminate\Queue\Middleware\WithoutOverlapping;

/**
 * The reaper of runs (spec 6.4, A475): leases, time limits and the reasons of waiting runs, as the default bot. The
 * scheduler puts it on the default queue every minute (routes/console.php); the middleware keeps two from running at
 * once (a second run is dropped).
 */
final class ReapLostRunsJob implements ShouldQueue
{
    use Queueable;

    /**
     * @return list<object>
     */
    public function middleware(): array
    {
        return [(new WithoutOverlapping('reap-lost-runs'))->dontRelease()->expireAfter(300)];
    }

    public function handle(): void
    {
        ReapLostRuns::run(Actor::system(User::defaultBot(), 'reap_runs'));
    }
}
