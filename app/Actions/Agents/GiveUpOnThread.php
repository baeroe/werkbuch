<?php

namespace App\Actions\Agents;

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
 * A job of a strand gave up on GitHub (A601): the merge of a head (`merge`) or making the draft PR of an epic ready
 * (`ready`). What it noted goes (`merge_sha` of that head, `ready_requested_at`: a new head, or ReadyEpic, decides
 * again), the agent says so in a comment at the item and the item goes to „Korrektur“. Nothing at a strand that ended
 * or decided otherwise meanwhile. Locks the item, the runs of the strand, then the strand.
 */
final class GiveUpOnThread
{
    use AsAction;

    public const WHAT = ['merge', 'ready'];

    public function handle(Actor $actor, string $threadId, string $what, ?string $sha = null): string
    {
        $thread = AgentThread::query()->find($threadId);
        if ($thread === null) {
            return 'stale';
        }

        return DB::transaction(function () use ($thread, $what, $sha): string {
            $item = WorkItem::query()->findOrFail($thread->work_item_id);
            ItemLock::take($item);
            [, $locked] = AgentFlow::lockStrand($thread);

            $noted = $what === 'merge' ? $locked->merge_sha !== null && $locked->merge_sha === $sha : $locked->ready_requested_at !== null;
            if ($locked->status !== AgentThread::OPEN || ! $noted) {
                return 'stale';
            }

            $locked->forceFill($what === 'merge' ? ['merge_sha' => null] : ['ready_requested_at' => null])->save();
            $bot = User::query()->findOrFail($locked->bot_id);
            AgentFlow::comment($bot, $item, __('agents.comment.gave_up.'.$what, ['pr' => '#'.$locked->pr_number], AgentFlow::locale()));
            AgentFlow::move($bot, $item, AgentStep::Correction);

            return 'gave_up';
        }, 3);
    }
}
