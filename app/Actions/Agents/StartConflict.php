<?php

namespace App\Actions\Agents;

use App\Actions\AgentRuns\CancelRun;
use App\Actions\AgentRuns\EnqueueRun;
use App\Domain\Agents\Brakes;
use App\Domain\Agents\RunStatus;
use App\Domain\Agents\RunType;
use App\Exceptions\Problem;
use App\Models\AgentProjectSettings;
use App\Models\AgentRun;
use App\Models\AgentThread;
use App\Models\User;
use App\Models\WorkItem;
use App\Support\Actor;
use App\Support\AgentFlow;
use App\Support\ItemLock;
use Illuminate\Support\Facades\DB;
use Lorisleiva\Actions\Concerns\AsAction;

/**
 * A conflict of the PR of an agent with its base (spec 7.1: `mergeable_state` `dirty`): a `conflict` run at the strand
 * that merges the base into the branch. It goes before CI and review: reviews of the PR that wait or run are canceled
 * (a new push follows). Once per head commit; at its own brake (spec 7.2, two by default, apart from the corrections)
 * the strand pauses. Nothing at a strand that ended or pauses.
 */
final class StartConflict
{
    use AsAction;

    public function handle(Actor $actor, AgentThread $thread, string $headSha): ?AgentRun
    {
        return DB::transaction(function () use ($actor, $thread, $headSha): ?AgentRun {
            $item = WorkItem::query()->findOrFail($thread->work_item_id);
            ItemLock::take($item);
            $runs = AgentFlow::openRuns($thread);
            $locked = AgentThread::query()->lockForUpdate()->findOrFail($thread->id);

            if ($locked->status !== AgentThread::OPEN || $runs->contains(fn (AgentRun $run) => $run->type === RunType::Conflict)
                || AgentRun::query()->where('thread_id', $locked->id)->where('type', RunType::Conflict->value)->where('head_sha', $headSha)->whereNot('status', RunStatus::Canceled->value)->exists()) {
                return null;
            }

            $settings = AgentProjectSettings::of($locked->project_id);
            if (! Brakes::allows(RunType::Conflict, $locked->corrections, $locked->conflicts, $settings->max_corrections, $settings->max_conflicts)) {
                PauseThread::run($actor, $locked, 'brake', (string) __('agents.findings.conflict', [], AgentFlow::locale()));

                return null;
            }

            foreach ($runs->filter(fn (AgentRun $run) => $run->type === RunType::Review) as $review) {
                CancelRun::stop($actor, $review);
            }

            try {
                $run = EnqueueRun::run($actor, User::query()->findOrFail($locked->bot_id), $item->project, $item, RunType::Conflict->value, $locked, ['head_sha' => $headSha]);
            } catch (Problem) {
                return null;
            }

            $locked->forceFill(['conflicts' => $locked->conflicts + 1, 'merge_sha' => null, 'review_sha' => null, 'review_verdict' => null])->save();

            return $run;
        }, 3);
    }
}
