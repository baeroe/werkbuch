<?php

namespace App\Actions\Agents;

use App\Domain\Agents\RunType;
use App\Domain\Workflow\AgentStep;
use App\Domain\Workflow\StateCategory;
use App\Jobs\MarkPullRequestReady;
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
 * An epic the agent works through is ready (spec 7.6) when no child is open any more: the children the agent did stand
 * in „In Review“, every other child is Completed or Canceled. Then werkbuch marks the draft PR ready (CI and review run
 * from there; their results before do not count) and the epic goes to „In Review“. Without a repo the epic is done
 * („Gemergt“). Without a PR the agent never opened one: a comment and „Korrektur“. Answers what it did.
 */
final class ReadyEpic
{
    use AsAction;

    public function handle(Actor $actor, AgentThread $thread): string
    {
        return DB::transaction(function () use ($actor, $thread): string {
            $epic = WorkItem::query()->findOrFail($thread->work_item_id);
            ItemLock::take($epic);
            $locked = AgentThread::query()->lockForUpdate()->findOrFail($thread->id);
            $bot = User::query()->findOrFail($locked->bot_id);

            if ($locked->status !== AgentThread::OPEN || ! self::done($locked, $epic) || AgentRun::query()->where('thread_id', $locked->id)->whereIn('status', ['queued', 'waiting', 'running', 'canceling'])->exists()) {
                return 'waiting';
            }

            if ($locked->repository_github_id === null) {
                CompleteThread::run($actor, $locked, 'merged');

                return 'done';
            }

            if ($locked->pr_number === null) {
                AgentFlow::comment($bot, $epic, __('agents.comment.no_pr', [], AgentFlow::locale()));
                AgentFlow::move($bot, $epic, AgentStep::Correction);

                return 'no_pr';
            }

            if ($locked->pr_draft && $locked->ready_requested_at === null) {
                $locked->forceFill(['ready_requested_at' => now()])->save();
                MarkPullRequestReady::dispatch($locked->id)->afterCommit();
            }
            AgentFlow::move($bot, $epic, AgentStep::Review);

            return 'ready';
        }, 3);
    }

    /** Whether no child of the epic is open: the agent did its children in this strand, the others are closed. */
    private static function done(AgentThread $thread, WorkItem $epic): bool
    {
        $did = AgentRun::query()->where('thread_id', $thread->id)->where('type', RunType::Task->value)->where('status', 'succeeded')->pluck('work_item_id')->all();

        return ! WorkItem::query()->where('parent_id', $epic->id)->whereNull('archived_at')->whereNotIn('id', $did)
            ->whereHas('state', fn ($query) => $query->whereNotIn('category', [StateCategory::Completed->value, StateCategory::Canceled->value]))->exists();
    }
}
