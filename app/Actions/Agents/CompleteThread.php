<?php

namespace App\Actions\Agents;

use App\Actions\AgentRuns\CancelRun;
use App\Domain\Agents\RunType;
use App\Domain\Workflow\AgentStep;
use App\Jobs\AdvanceAgentEpic;
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
 * The end of a strand (spec 7.2, 7.6). `merged` (werkbuch merged its PR, a person merged it on GitHub, or a strand
 * without a repo finished): the strand is `merged`, its item goes to „Gemergt“, of an epic by rule A also the children
 * the agent did (children that are closed stay, children of persons are theirs); a child merged into the branch of its
 * epic (WEBU-71) has the epic go on after the commit (AdvanceEpic). `closed` (a person closed the PR without a
 * merge): the strand ends, the item goes to „Korrektur“ with a comment. What of the strand still waits or runs is
 * canceled. A strand that ended already stays as it is.
 */
final class CompleteThread
{
    use AsAction;

    public function handle(Actor $actor, AgentThread $thread, string $outcome): AgentThread
    {
        return DB::transaction(function () use ($actor, $thread, $outcome): AgentThread {
            // the item before the runs and the strand, as every action of the flow locks them
            ItemLock::take(WorkItem::query()->findOrFail($thread->work_item_id));

            foreach (AgentFlow::openRuns($thread) as $run) {
                CancelRun::stop($actor, $run);
            }

            $locked = AgentThread::query()->lockForUpdate()->findOrFail($thread->id);
            if ($locked->status === AgentThread::MERGED || $locked->status === AgentThread::CLOSED) {
                return $locked;
            }

            $locked->forceFill(['status' => $outcome === 'merged' ? AgentThread::MERGED : AgentThread::CLOSED, 'awaiting_pr_since' => null])->save();
            // a child merged into the branch of its epic (WEBU-71): the epic goes on
            if ($outcome === 'merged' && $locked->parent_thread_id !== null) {
                AdvanceAgentEpic::dispatch($locked->parent_thread_id)->afterCommit();
            }
            $bot = User::query()->findOrFail($locked->bot_id);
            $item = WorkItem::query()->findOrFail($locked->work_item_id);

            if ($outcome !== 'merged') {
                AgentFlow::move($bot, $item, AgentStep::Correction);
                AgentFlow::comment($bot, $item, __('agents.comment.closed', ['pr' => '#'.$locked->pr_number], AgentFlow::locale()));

                return $locked;
            }

            $done = AgentRun::query()->where('thread_id', $locked->id)->where('type', RunType::Task->value)->where('status', 'succeeded')
                ->whereNot('work_item_id', $item->id)->pluck('work_item_id')->unique();
            foreach (WorkItem::query()->whereKey($done)->where('assignee_id', $bot->id)->orderBy('id')->get() as $child) {
                AgentFlow::move($bot, $child, AgentStep::Merged);
            }
            AgentFlow::move($bot, $item, AgentStep::Merged);

            return $locked;
        }, 3);
    }
}
