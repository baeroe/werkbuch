<?php

namespace App\Actions\Agents;

use App\Domain\Workflow\AgentStep;
use App\Models\AgentRun;
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

            if ($thread !== null && $thread->work_item_id !== null && $thread->work_item_id !== $item->id) {
                AgentFlow::move($run->bot, WorkItem::query()->findOrFail($thread->work_item_id), AgentStep::Working);
                if ($item->assignee_id === null) {
                    AgentFlow::assign($run->bot, $item, $run->bot_id);
                }
            }

            AgentFlow::move($run->bot, $item, AgentStep::Working);
        }, 3);
    }
}
