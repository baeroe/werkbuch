<?php

namespace App\Actions\Agents;

use App\Domain\Agents\RunStatus;
use App\Domain\Agents\RunType;
use App\Domain\Workflow\AgentStep;
use App\Jobs\PostReviewVerdict as PostReviewVerdictJob;
use App\Models\AgentRun;
use App\Models\AgentThread;
use App\Models\User;
use App\Models\WorkItem;
use App\Models\WorkItemLink;
use App\Support\Actor;
use App\Support\AgentFlow;
use App\Support\ItemLock;
use Illuminate\Support\Facades\DB;
use Lorisleiva\Actions\Concerns\AsAction;

/**
 * What werkbuch does with the end of a run (spec 7.1, 7.2): the agent never does it itself.
 * - `comment`: its answer as a comment of the bot at the item.
 * - `review`: the verdict and the findings as a comment at the item and at the PR (for a PR of a person a GitHub
 *   review: approve or a comment, never „request changes“); at the PR of an agent an approve may merge, findings make a
 *   correction. A review of a commit the PR has left behind changes nothing.
 * - `task`, `correction`, `conflict`: with a repo the item goes to „In Review“ once the strand has its PR (a task waits
 *   for it, SweepAgentThreads); a child of an epic hands over to the next child, the last makes the PR ready. Without a
 *   repo the summary becomes a comment and the item „Gemergt“ (spec 7.1).
 * - `failed`, `timed_out`, `lost`: a comment with the reason, the item to „Korrektur“, no new attempt (spec 7.2).
 * - `canceled`: nothing.
 */
final class HandleRunResult
{
    use AsAction;

    public function handle(Actor $actor, AgentRun $run): string
    {
        $run = $run->fresh(['bot', 'workItem', 'thread', 'project']) ?? $run;

        return match (true) {
            $run->status === RunStatus::Canceled => self::canceled($actor, $run),
            ! $run->status->finished() => 'nothing',
            $run->status !== RunStatus::Succeeded => self::failed($run),
            $run->type === RunType::Comment => self::answer($run),
            $run->type === RunType::Review => self::review($actor, $run),
            default => self::code($actor, $run),
        };
    }

    private static function failed(AgentRun $run): string
    {
        $item = $run->workItem;
        if ($item === null) {
            return 'nothing';
        }

        $reason = $run->error ?? $run->status->value;
        AgentFlow::comment($run->bot, $item, __('agents.comment.failed', ['type' => $run->type->value, 'reason' => $reason], AgentFlow::locale()));
        // a review of the PR of an agent that failed holds the strand as a failed correction would (A598)
        if (! $run->type->light() || ($run->type === RunType::Review && $run->thread !== null)) {
            AgentFlow::move($run->bot, $item, AgentStep::Correction);
        }

        return 'failed';
    }

    /**
     * A task of a child of an epic was canceled because the child left the agent (a person took or closed it, A599): the
     * strand goes on with the next child, or the epic is ready. Any other canceled run: nothing.
     */
    private static function canceled(Actor $actor, AgentRun $run): string
    {
        $thread = $run->thread;
        if ($run->type !== RunType::Task || $thread === null || $run->work_item_id === null || $thread->work_item_id === $run->work_item_id || $thread->status !== AgentThread::OPEN) {
            return 'nothing';
        }

        return self::continueEpic($actor, $thread) ?? 'nothing';
    }

    /**
     * The next step of an epic the agent works through, once none of its runs is open any more: the task of the next
     * child, else ReadyEpic. Null while a run of the strand is open.
     */
    public static function continueEpic(Actor $actor, AgentThread $thread): ?string
    {
        if ($thread->fresh()?->status !== AgentThread::OPEN || AgentFlow::openRuns($thread)->isNotEmpty()) {
            return null;
        }

        $epic = WorkItem::query()->findOrFail($thread->work_item_id);
        $bot = User::query()->findOrFail($thread->bot_id);
        $next = StartTask::nextChild($thread, $epic, $bot);

        return $next !== null && StartTask::enqueue($actor, $bot, $thread, $next, null) !== null ? 'next_child' : ReadyEpic::run($actor, $thread);
    }

    private static function answer(AgentRun $run): string
    {
        if ($run->workItem !== null) {
            AgentFlow::comment($run->bot, $run->workItem, (string) ($run->result['text'] ?? $run->result['summary'] ?? __('agents.comment.no_answer', [], AgentFlow::locale())));
        }

        return 'answered';
    }

    private static function review(Actor $actor, AgentRun $run): string
    {
        $verdict = $run->result['verdict'] ?? 'changes';
        $text = (string) ($run->result['text'] ?? '');

        return DB::transaction(function () use ($actor, $run, $verdict, $text): string {
            $items = WorkItem::query()->whereIn('id', WorkItemLink::query()->select('work_item_id')
                ->where('repository_github_id', $run->repository_github_id)->where('number', $run->pr_number))->orderBy('id')->get();
            foreach ($items as $item) {
                ItemLock::take($item);
            }

            // the items, the runs of the strand, then the strand (A592)
            $thread = $run->thread === null ? null : AgentFlow::lockStrand($run->thread)[1];
            if ($thread !== null && ($thread->status !== AgentThread::OPEN || $thread->head_sha !== $run->head_sha)) {
                return 'stale';
            }

            // the PR of a person moved on meanwhile: no approve of a commit it left, the links keep their review (A596)
            if ($thread === null && WorkItemLink::query()->where('repository_github_id', $run->repository_github_id)->where('number', $run->pr_number)
                ->where('head_sha', '!=', $run->head_sha)->exists()) {
                return 'stale';
            }

            WorkItemLink::query()->where('repository_github_id', $run->repository_github_id)->where('number', $run->pr_number)
                ->update(['review' => $verdict, 'review_sha' => $run->head_sha]);
            $body = __('agents.comment.review.'.$verdict, ['pr' => '#'.$run->pr_number, 'sha' => substr((string) $run->head_sha, 0, 7)], AgentFlow::locale())."\n\n".$text;
            foreach ($thread === null ? $items : $items->where('id', $thread->work_item_id) as $item) {
                AgentFlow::comment($run->bot, $item, $body);
            }
            PostReviewVerdictJob::dispatch($run->id)->afterCommit();

            if ($thread === null) {
                return 'reviewed';
            }

            $thread->forceFill(['review_sha' => $run->head_sha, 'review_verdict' => $verdict])->save();

            if ($verdict === 'approve') {
                ApproveAndMerge::run($actor, $thread);

                return 'approved';
            }

            StartCorrection::run($actor, $thread, 'review', $text, $run->head_sha);

            return 'changes';
        }, 3);
    }

    private static function code(Actor $actor, AgentRun $run): string
    {
        $thread = $run->thread;
        $item = $run->workItem;
        if ($thread === null || $item === null) {
            return 'nothing';
        }

        $outcome = self::coded($actor, $run, $thread, $item);

        // CI and review of the head waited for the run (A593): now they count
        $fresh = $thread->fresh();
        if ($fresh !== null && $fresh->status === AgentThread::OPEN && $fresh->repository_github_id !== null && $fresh->head_sha !== null) {
            HandleCheckResult::run($actor, $fresh->repository_github_id, $fresh->head_sha);
        }

        return $outcome;
    }

    private static function coded(Actor $actor, AgentRun $run, AgentThread $thread, WorkItem $item): string
    {
        // the moves only while the item is still with the agent, or nobody's (a person may have taken it meanwhile, A599)
        $mine = fn (WorkItem $of): bool => in_array($of->fresh()?->assignee_id, [$run->bot_id, null], true);

        if ($thread->repository_github_id === null) {
            AgentFlow::comment($run->bot, $item, (string) ($run->result['summary'] ?? __('agents.comment.done', [], AgentFlow::locale())));
            if ($thread->work_item_id === $item->id) {
                CompleteThread::run($actor, $thread, 'merged');

                return 'done';
            }
            if ($mine($item)) {
                AgentFlow::move($run->bot, $item, AgentStep::Merged);
            }

            return self::continueEpic($actor, $thread) ?? 'waiting';
        }

        if ($thread->work_item_id !== $item->id) {
            if ($mine($item)) {
                AgentFlow::move($run->bot, $item, AgentStep::Review);
            }

            return self::continueEpic($actor, $thread) ?? 'waiting';
        }

        $outcome = DB::transaction(function () use ($run, $thread, $item, $mine): string {
            ItemLock::take($item);
            [, $locked] = AgentFlow::lockStrand($thread);
            if ($locked->pr_number !== null) {
                if ($mine($item) && $locked->status === AgentThread::OPEN) {
                    AgentFlow::move($run->bot, $item, AgentStep::Review);
                }

                return 'review';
            }

            $locked->forceFill(['awaiting_pr_since' => now()])->save();

            return 'awaiting_pr';
        }, 3);

        // a correction at an epic whose PR werkbuch could not make ready (A601) makes it ready again
        return $outcome === 'review' && AgentFlow::epicPending($thread) ? ReadyEpic::run($actor, $thread) : $outcome;
    }
}
