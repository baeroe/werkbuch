<?php

namespace App\Actions\Agents;

use App\Domain\Workflow\AgentStep;
use App\Models\AgentRun;
use App\Models\AgentThread;
use App\Models\WorkItem;
use App\Support\Actor;
use App\Support\AgentFlow;
use Illuminate\Support\Facades\DB;
use Lorisleiva\Actions\Concerns\AsAction;

/**
 * A runner took a run that changes code (spec 7.2): its item goes to „In Arbeit“. A child of an epic the agent works
 * through is given to the bot first (it takes the child itself, as the agent: that sets off nothing, spec 7.6), and
 * the epic goes to „In Arbeit“ too. Light runs move nothing.
 */
final class HandleRunStarted
{
    use AsAction;

    public function handle(Actor $actor, AgentRun $run): void
    {
        if ($run->type->light() || $run->workItem === null) {
            return;
        }

        DB::transaction(function () use ($run): void {
            $item = $run->workItem;
            $thread = $run->thread;

            // the child before its epic, as a move that closes a parent locks them (A592)
            if ($item->assignee_id === null && $thread !== null && ($thread->work_item_id !== $item->id || $thread->parent_thread_id !== null)) {
                AgentFlow::assign($run->bot, $item, $run->bot_id);
            }
            AgentFlow::move($run->bot, $item, AgentStep::Working);

            // the epic of a child: of the strand by rule A, of the epic strand for a child on its branch (WEBU-71)
            $epicId = $thread?->parent_thread_id !== null ? AgentThread::query()->whereKey($thread->parent_thread_id)->value('work_item_id')
                : ($thread !== null && $thread->work_item_id !== $item->id ? $thread->work_item_id : null);
            if (is_string($epicId)) {
                AgentFlow::move($run->bot, WorkItem::query()->findOrFail($epicId), AgentStep::Working);
            }
        }, 3);
    }
}
