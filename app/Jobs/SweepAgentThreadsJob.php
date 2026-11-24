<?php

namespace App\Jobs;

use App\Actions\Agents\SweepAgentThreads;
use App\Models\User;
use App\Support\Actor;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Foundation\Queue\Queueable;
use Illuminate\Queue\Middleware\WithoutOverlapping;

/**
 * Every minute (spec 7.2): a task without a PR, a PR without checks (SweepAgentThreads).
 */
final class SweepAgentThreadsJob implements ShouldQueue
{
    use Queueable;

    /** @return list<object> */
    public function middleware(): array
    {
        return [(new WithoutOverlapping('sweep-agent-threads'))->dontRelease()];
    }

    public function handle(): void
    {
        SweepAgentThreads::run(Actor::system(User::defaultBot(), 'agents'));
    }
}
