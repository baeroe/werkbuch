<?php

namespace App\Actions\Agents;

use App\Domain\Agents\RunType;
use App\Domain\Workflow\AgentStep;
use App\Domain\Workflow\StateCategory;
use App\Jobs\MarkPullRequestReady;
use App\Models\AgentRun;
use App\Models\AgentThread;
use App\Models\User;
use App\Models\Workflow;
use App\Models\WorkItem;
use App\Support\Actor;
use App\Support\AgentFlow;
use App\Support\ItemLock;
use Illuminate\Support\Facades\DB;
use Lorisleiva\Actions\Concerns\AsAction;

/**
 * An epic the agent works through is ready (spec 7.6) when no child is open or waits for a person (WEBU-50) any more: the children the agent did stand
 * in „In Review“, every other child is Completed or Canceled. Then werkbuch notes it (`ready_requested_at`: CI and review
 * count from there, A594), marks a draft PR ready and the epic goes to „In Review“; a PR the agent opened as no draft
 * has its CI looked at at once. Without a repo the epic is done
 * („Gemergt“). Without a PR the agent never opened one: a comment and „Korrektur“. Answers what it did.
 */
final class ReadyEpic
{
    use AsAction;

    public function handle(Actor $actor, AgentThread $thread): string
    {
        $outcome = DB::transaction(function () use ($actor, $thread): string {
            $epic = WorkItem::query()->findOrFail($thread->work_item_id);
            ItemLock::take($epic);
            // the epic, the runs of the strand, then the strand (A592)
            [$runs, $locked] = AgentFlow::lockStrand($thread);
            $bot = User::query()->findOrFail($locked->bot_id);

            if ($locked->status !== AgentThread::OPEN || ! self::done($locked, $epic) || $runs->isNotEmpty()) {
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

            // ready for CI and review from here on (A594), also when the agent opened its PR as no draft
            if ($locked->ready_requested_at === null) {
                $locked->forceFill(['ready_requested_at' => now()])->save();
                if ($locked->pr_draft) {
                    MarkPullRequestReady::dispatch($locked->id)->afterCommit();
                }
            }
            AgentFlow::move($bot, $epic, AgentStep::Review);

            return 'ready';
        }, 3);

        // a PR that is no draft has its CI already: it counts now
        $fresh = $thread->fresh();
        if ($outcome === 'ready' && $fresh !== null && ! $fresh->pr_draft && $fresh->repository_github_id !== null && $fresh->head_sha !== null) {
            HandleCheckResult::run($actor, $fresh->repository_github_id, $fresh->head_sha);
        }

        return $outcome;
    }

    /** Whether no child of the epic is open: the agent did its children in this strand, the others are closed. */
    private static function done(AgentThread $thread, WorkItem $epic): bool
    {
        $did = AgentRun::query()->where('thread_id', $thread->id)->where('type', RunType::Task->value)->where('status', 'succeeded')->pluck('work_item_id')->all();

        // a child that waits for a person (WEBU-50) keeps the epic from being ready
        $blocked = Workflow::query()->find($epic->project->workflow_id)?->agentStates()['blocked'] ?? null;
        if ($blocked !== null && WorkItem::query()->where('parent_id', $epic->id)->whereNull('archived_at')->where('state_id', $blocked)->exists()) {
            return false;
        }

        return ! WorkItem::query()->where('parent_id', $epic->id)->whereNull('archived_at')->whereNotIn('id', $did)
            ->whereHas('state', fn ($query) => $query->whereNotIn('category', [StateCategory::Completed->value, StateCategory::Canceled->value]))->exists();
    }
}
