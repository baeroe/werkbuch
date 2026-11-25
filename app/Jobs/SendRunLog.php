<?php

namespace App\Jobs;

use App\Live\RunLog;
use App\Models\AgentRun;
use Illuminate\Contracts\Queue\ShouldBeUniqueUntilProcessing;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Foundation\Queue\Queueable;

/**
 * The message `agent_run.log` at the end of a pause (RunLog, A641): the lines that came within the pause are told too.
 * One per run waits at a time; a run that is gone tells nobody. On the queue `live`, once: a late message is worth
 * nothing.
 */
final class SendRunLog implements ShouldBeUniqueUntilProcessing, ShouldQueue
{
    use Queueable;

    public int $tries = 1;

    /** Seconds the one waiting job of a run keeps others away at most. */
    public int $uniqueFor = 10;

    public function __construct(public readonly string $runId)
    {
        $this->onQueue('live');
    }

    public function uniqueId(): string
    {
        return $this->runId;
    }

    public function handle(): void
    {
        $run = AgentRun::query()->find($this->runId);
        if ($run !== null) {
            RunLog::send($run);
        }
    }
}
