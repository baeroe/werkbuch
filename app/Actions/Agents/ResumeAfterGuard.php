<?php

namespace App\Actions\Agents;

use App\Actions\GitHub\ConfirmMergeGuard;
use App\Domain\Agents\RunStatus;
use App\Domain\Agents\RunType;
use App\Models\AgentRun;
use App\Models\AgentThread;
use App\Support\Actor;
use App\Support\AgentFlow;
use Lorisleiva\Actions\Concerns\AsAction;

/**
 * A project admin confirmed an unauthorized merge (spec 11.3, A516): the strands the guard paused are open again, and
 * the work it held back comes now. A strand whose last run that changes code was canceled by the guard gets a correction
 * that says so; runs that waited (also of assignments meanwhile) start by themselves (RunQueue). Answers how many
 * corrections it queued.
 *
 * @see ConfirmMergeGuard
 */
final class ResumeAfterGuard
{
    use AsAction;

    /**
     * @param  list<string>  $threadIds  the strands the confirmation opened
     */
    public function handle(Actor $actor, array $threadIds): int
    {
        $count = 0;
        foreach (AgentThread::query()->whereKey($threadIds)->where('status', AgentThread::OPEN)->orderBy('id')->get() as $thread) {
            $last = AgentRun::query()->where('thread_id', $thread->id)->whereIn('type', [RunType::Task->value, RunType::Correction->value, RunType::Conflict->value])
                ->orderByDesc('id')->first();

            if ($last !== null && $last->status === RunStatus::Canceled
                && StartCorrection::run($actor, $thread, 'guard', (string) __('agents.findings.guard', [], AgentFlow::locale()), null) !== null) {
                $count++;
            }
        }

        return $count;
    }
}
