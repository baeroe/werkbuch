<?php

namespace App\Actions\Agents;

use App\Actions\AgentRuns\CancelRun;
use App\Domain\Workflow\AgentStep;
use App\Models\AgentThread;
use App\Models\User;
use App\Models\WorkItem;
use App\Support\Actor;
use App\Support\AgentFlow;
use App\Support\ItemLock;
use Illuminate\Support\Facades\DB;
use Lorisleiva\Actions\Concerns\AsAction;

/**
 * Pauses a strand (spec 7.2): its PR, branch, worktree and session stay, what of it waits or runs is canceled. At the
 * brake (`brake`) the item goes to „Korrektur“ and to the responsible person of the bot, with the last finding in a
 * comment of the agent (that assignment ends nothing: its actor is the agent). A person who gives the item to someone
 * else pauses it too (`reassigned`).
 */
final class PauseThread
{
    use AsAction;

    public const REASONS = ['brake', 'reassigned'];

    public function handle(Actor $actor, AgentThread $thread, string $reason, ?string $finding = null): AgentThread
    {
        return DB::transaction(function () use ($actor, $thread, $reason, $finding): AgentThread {
            // the item before the runs and the strand, as every action of the flow locks them
            ItemLock::take(WorkItem::query()->findOrFail($thread->work_item_id));

            foreach (AgentFlow::openRuns($thread) as $run) {
                CancelRun::stop($actor, $run);
            }

            $locked = AgentThread::query()->lockForUpdate()->findOrFail($thread->id);
            if ($locked->status !== AgentThread::OPEN) {
                return $locked;
            }

            $locked->forceFill(['status' => AgentThread::PAUSED, 'pause_reason' => $reason])->save();

            if ($reason === 'brake') {
                $bot = User::query()->findOrFail($locked->bot_id);
                $item = WorkItem::query()->findOrFail($locked->work_item_id);
                AgentFlow::move($bot, $item, AgentStep::Correction);
                if ($bot->owner_id !== null) {
                    AgentFlow::assign($bot, $item, $bot->owner_id);
                }
                AgentFlow::comment($bot, $item, __('agents.comment.brake', [], AgentFlow::locale())."\n\n".($finding ?? ''));
            }

            return $locked;
        }, 3);
    }
}
