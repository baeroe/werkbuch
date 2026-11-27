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
 * comment of the agent (that assignment ends nothing: its actor is the agent); so too when a run that should change
 * code pushed nothing (`no_change`, A606), and when the run could not do what the item asks (`needs_person`, WEBU-50: the
 * item goes to „Pending“ with a comment of what is needed). A person who gives the item to someone
 * else pauses it too (`reassigned`), and one who cancels the item (`canceled`, A595).
 */
final class PauseThread
{
    use AsAction;

    public const REASONS = ['brake', 'no_change', 'needs_person', 'reassigned', 'canceled'];

    /** @param  string|null  $runId  the run that ended without a change (`no_change`): its comment names it (A643) */
    public function handle(Actor $actor, AgentThread $thread, string $reason, ?string $finding = null, ?string $runId = null): AgentThread
    {
        return DB::transaction(function () use ($actor, $thread, $reason, $finding, $runId): AgentThread {
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

            if (in_array($reason, ['brake', 'no_change', 'needs_person'], true)) {
                $bot = User::query()->findOrFail($locked->bot_id);
                $item = WorkItem::query()->findOrFail($locked->work_item_id);
                AgentFlow::move($bot, $item, $reason === 'needs_person' ? AgentStep::Blocked : AgentStep::Correction);
                if ($bot->owner_id !== null) {
                    AgentFlow::assign($bot, $item, $bot->owner_id);
                }
                $said = __('agents.comment.'.$reason, [], AgentFlow::locale());
                AgentFlow::comment($bot, $item, rtrim($said."\n\n".($finding ?? '')), $runId);
            }

            return $locked;
        }, 3);
    }
}
