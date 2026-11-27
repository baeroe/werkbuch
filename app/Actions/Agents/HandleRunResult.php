<?php

namespace App\Actions\Agents;

use App\Domain\Agents\RunStatus;
use App\Domain\Agents\RunType;
use App\Domain\Workflow\AgentStep;
use App\Events\EventType;
use App\Jobs\PostReviewVerdict as PostReviewVerdictJob;
use App\Models\AgentRun;
use App\Models\AgentThread;
use App\Models\Event;
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
 *   repo the summary becomes a comment and the item „Gemergt“ (spec 7.1). A run at a PR that pushed nothing merges
 *   nothing: findings that waited meanwhile make a correction, else the strand pauses for a person (A606, A607).
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

        // findings that waited for a run that changes code die with it: the next run starts from the item (A607)
        if ($run->thread !== null && in_array($run->type, AgentFlow::CODE, true)) {
            AgentThread::query()->whereKey($run->thread->id)->update(['pending_findings' => null]);
        }

        $reason = $run->error ?? $run->status->value;
        AgentFlow::comment($run->bot, $item, __('agents.comment.failed', ['type' => $run->type->value, 'reason' => $reason], AgentFlow::locale()), $run->id);
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
        $child = $run->workItem?->fresh(['state']);
        if ($run->type !== RunType::Task || $thread === null || $child === null || $thread->work_item_id === $child->id || $thread->status !== AgentThread::OPEN) {
            return 'nothing';
        }

        // a child still with the agent: someone stopped the run itself, the strand waits for them
        if (in_array($child->assignee_id, [$run->bot_id, null], true) && ! $child->state->category->isClosed()) {
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

        if ($next === null && StartTask::waitsForReady($thread, $epic, $bot)) {
            return 'waiting_ready'; // children in the backlog: the epic is not ready yet (A772)
        }

        return $next !== null && StartTask::enqueue($actor, $bot, $thread, $next, null) !== null ? 'next_child' : ReadyEpic::run($actor, $thread);
    }

    private static function answer(AgentRun $run): string
    {
        if ($run->workItem !== null) {
            AgentFlow::comment($run->bot, $run->workItem, (string) ($run->result['text'] ?? $run->result['summary'] ?? __('agents.comment.no_answer', [], AgentFlow::locale())), $run->id);
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
            [$runs, $thread] = $run->thread === null ? [collect(), null] : AgentFlow::lockStrand($run->thread);
            if ($thread !== null && ($thread->status !== AgentThread::OPEN || $thread->head_sha !== $run->head_sha)) {
                return 'stale';
            }

            // the PR of a person moved on meanwhile: no approve of a commit it left, the links keep their review (A596)
            if ($thread === null && WorkItemLink::query()->where('repository_github_id', $run->repository_github_id)->where('number', $run->pr_number)
                ->where('head_sha', '!=', $run->head_sha)->exists()) {
                return 'stale';
            }

            // a run that changes code is at work (a correction a person asked for, A606): an approve of the commit it
            // starts on is no verdict the strand keeps, and none goes to GitHub; findings wait for its end (A607)
            $coding = $thread !== null && $runs->contains(fn (AgentRun $open) => in_array($open->type, AgentFlow::CODE, true));
            $held = $coding && $verdict === 'approve';

            WorkItemLink::query()->where('repository_github_id', $run->repository_github_id)->where('number', $run->pr_number)
                ->update(['review' => $held ? null : $verdict, 'review_sha' => $held ? null : $run->head_sha]);
            $sha = substr((string) $run->head_sha, 0, 7);
            $body = ($held ? __('agents.comment.review.held', ['pr' => '#'.$run->pr_number, 'sha' => $sha], AgentFlow::locale())
                : __('agents.comment.review.'.$verdict, ['pr' => '#'.$run->pr_number, 'sha' => $sha], AgentFlow::locale()))."\n\n".$text;
            foreach ($thread === null ? $items : $items->where('id', $thread->work_item_id) as $item) {
                AgentFlow::comment($run->bot, $item, $body, $run->id);
            }
            if (! $held) {
                PostReviewVerdictJob::dispatch($run->id)->afterCommit();
            }

            if ($thread === null) {
                return 'reviewed';
            }

            if ($held) {
                return 'held';
            }
            if (! $coding) {
                $thread->forceFill(['review_sha' => $run->head_sha, 'review_verdict' => $verdict])->save();
            }

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

        if (($run->result['outcome'] ?? null) === 'blocked') {
            return self::blocked($actor, $run, $thread, $item);
        }

        // the run of the strand's own item at a PR: did it push (A606)? The head the strand knows, or the commit the runner
        // reports (the webhook of the push may come after the result)
        $start = $run->context['start_head'] ?? null;
        $own = $thread->repository_github_id !== null && $thread->work_item_id === $item->id && is_string($start);
        $commit = $run->result['commit'] ?? null;
        $commit = is_string($commit) && $commit !== '' ? $commit : null;
        $unmoved = $own && $thread->fresh()?->head_sha === $start;
        $recheck = false;
        if ($unmoved && $commit === null) {
            $outcome = self::unchanged($actor, $run, $thread, $item);
            if ($outcome !== 'recheck') {
                return $outcome;
            }
            $recheck = true;
        } elseif ($own) {
            // a commit the PR does not have yet: the webhook of its push should come; the sweep looks when it does not
            // (A610)
            $thread->forceFill(['pending_findings' => null, 'pushed_sha' => $unmoved ? $commit : null, 'pushed_at' => $unmoved ? now() : null])->save();
        }

        $outcome = self::coded($actor, $run, $thread, $item);

        // CI and review of the head waited for the run (A593): now they count; a head the strand does not know yet
        // (the push is on its way) waits for its webhook
        $fresh = $thread->fresh();
        if ($fresh !== null && $fresh->status === AgentThread::OPEN && $fresh->repository_github_id !== null && $fresh->head_sha !== null
            && (! $own || $fresh->head_sha !== $start || $recheck)) {
            HandleCheckResult::run($actor, $fresh->repository_github_id, $fresh->head_sha);
        }

        return $outcome;
    }

    /**
     * The agent could not do what the item asks (`Outcome: blocked`, WEBU-50): a comment of what it needs, the item to
     * „Pending“ and to the responsible person, no review, no merge. At its own item the strand pauses (`needs_person`);
     * a child of an epic leaves the strand running, the next child goes on and the epic is not ready while a child waits.
     */
    private static function blocked(Actor $actor, AgentRun $run, AgentThread $thread, WorkItem $item): string
    {
        $text = isset($run->result['summary']) ? (string) $run->result['summary'] : null;

        if ($thread->work_item_id === $item->id) {
            PauseThread::run($actor, $thread, 'needs_person', $text, $run->id);

            return 'blocked';
        }

        AgentFlow::comment($run->bot, $item, rtrim(__('agents.comment.needs_person', [], AgentFlow::locale())."\n\n".($text ?? '')), $run->id);
        AgentFlow::move($run->bot, $item, AgentStep::Blocked);
        if ($run->bot->owner_id !== null) {
            AgentFlow::assign($run->bot, $item, $run->bot->owner_id);
        }

        return self::continueEpic($actor, $thread) ?? 'blocked';
    }

    /**
     * A run that should change the code of a PR pushed nothing (A606, A607): no merge on the verdicts of before. Findings
     * of CI or a review that came meanwhile become a correction (the brake counts); without any the strand pauses, the
     * item goes to „Korrektur“ and to the responsible person with a comment that nothing changed. The correction after
     * the guard on a head no review judged is no such case: it answers `recheck`, the head is looked at (A610).
     */
    private static function unchanged(Actor $actor, AgentRun $run, AgentThread $thread, WorkItem $item): string
    {
        return DB::transaction(function () use ($actor, $run, $thread, $item): string {
            ItemLock::take($item);
            [, $locked] = AgentFlow::lockStrand($thread);
            // findings of the head the run started on and left as it was; of another head they judged something else
            $pending = $locked->pending_findings;
            $pending = $pending !== null && $pending['head'] === $locked->head_sha ? $pending : null;
            $locked->forceFill(['pending_findings' => null])->save();
            if ($locked->status !== AgentThread::OPEN) {
                return 'nothing';
            }

            if ($pending !== null) {
                return StartCorrection::run($actor, $locked, $pending['source'], $pending['text']) === null ? 'nothing' : 'correction';
            }

            // the correction after the guard had nothing to change (the work of the canceled run stood already): its
            // head was never judged, CI and review look at it now (A610)
            if (($run->context['source'] ?? null) === 'guard' && $locked->review_sha !== $locked->head_sha) {
                return 'recheck';
            }

            // a correction that only set the proof of the item changed nothing to review in the code: the head is judged
            // again (the review of it no longer counts, so a new one may start)
            if ($run->type === RunType::Correction && self::setProof($run, $item)) {
                AgentRun::query()->where('repository_github_id', $locked->repository_github_id)->where('pr_number', $locked->pr_number)
                    ->where('type', RunType::Review->value)->where('head_sha', $locked->head_sha)->get()
                    ->each(fn (AgentRun $review) => $review->forceFill(['context' => [...($review->context ?? []), 'superseded' => true]])->save());
                $locked->forceFill(['review_sha' => null, 'review_verdict' => null])->save();

                return 'recheck';
            }

            PauseThread::run($actor, $locked, 'no_change', isset($run->result['summary']) ? (string) $run->result['summary'] : null, $run->id);

            return 'no_change';
        }, 3);
    }

    /** Did the run set `resolution_proof` of the item (its token wrote the event while it ran)? */
    private static function setProof(AgentRun $run, WorkItem $item): bool
    {
        return Event::query()->where('type', EventType::WorkItemUpdated->value)->where('actor_id', $run->bot_id)
            ->where('subject_type', $item->getMorphClass())->where('subject_id', $item->id)
            ->where('occurred_at', '>=', $run->started_at)->get()
            ->contains(fn (Event $event) => isset($event->changes['values.resolution_proof']));
    }

    private static function coded(Actor $actor, AgentRun $run, AgentThread $thread, WorkItem $item): string
    {
        // the moves only while the item is still with the agent, or nobody's (a person may have taken it meanwhile, A599)
        $mine = fn (WorkItem $of): bool => in_array($of->fresh()?->assignee_id, [$run->bot_id, null], true);

        if ($thread->repository_github_id === null) {
            AgentFlow::comment($run->bot, $item, (string) ($run->result['summary'] ?? __('agents.comment.done', [], AgentFlow::locale())), $run->id);
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
