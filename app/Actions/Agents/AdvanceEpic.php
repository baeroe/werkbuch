<?php

namespace App\Actions\Agents;

use App\GitHub\GitHubApi;
use App\GitHub\GitHubUnavailable;
use App\GitHub\InstallationTokens;
use App\Models\AgentThread;
use App\Models\ProjectRepository;
use App\Models\User;
use App\Models\WorkItem;
use App\Support\Actor;
use App\Support\AgentFlow;
use App\Support\ItemLock;
use Illuminate\Support\Facades\DB;
use Lorisleiva\Actions\Concerns\AsAction;
use RuntimeException;

/**
 * The next step of an epic on its own branch (WEBU-71), after a child merged into it and every minute (the sweep):
 * - its draft PR into the base of the project, once a child merged into the branch of the epic (GitHub takes no PR
 *   without a difference); werkbuch opens it with a token of its own (no HTTP under a lock);
 * - while a child strand is open, nothing (one child at a time);
 * - an epic the bot of its strand has: the strand of the next open child that may begin (StartTask::nextOfEpic);
 * - no child open any more: the epic is ready (ReadyEpic: ready PR, then the review of the whole epic);
 * - children open, none can begin (a blocker, the backlog, a person): the epic waits, the agent says so at it once
 *   for every set of children it waits for.
 * Answers what it did.
 */
final class AdvanceEpic
{
    use AsAction;

    public const PERMISSIONS = ['contents' => 'write', 'pull_requests' => 'write'];

    public function handle(Actor $actor, string $threadId): string
    {
        $thread = AgentThread::query()->find($threadId);
        if ($thread === null || ! $thread->per_child || $thread->status !== AgentThread::OPEN || $thread->ready_requested_at !== null) {
            return 'stale';
        }

        if ($thread->pr_number === null && $thread->repository_github_id !== null
            && AgentThread::query()->where('parent_thread_id', $thread->id)->where('status', AgentThread::MERGED)->exists()) {
            self::openPr($thread);
        }

        $outcome = DB::transaction(function () use ($actor, $thread): string {
            $epic = ItemLock::take(WorkItem::query()->findOrFail($thread->work_item_id));
            [, $locked] = AgentFlow::lockStrand($thread);
            if ($locked->status !== AgentThread::OPEN || $locked->ready_requested_at !== null) {
                return 'stale';
            }
            if (AgentThread::query()->where('parent_thread_id', $locked->id)->where('status', AgentThread::OPEN)->exists()) {
                return 'working';
            }

            $bot = User::query()->findOrFail($locked->bot_id);
            $worked = $epic->assignee_id === $bot->id && AgentFlow::refusal($bot, $epic->project) === null;
            if ($worked && StartTask::nextOfEpic($actor, $locked, $epic, $bot, null) !== null) {
                return 'next_child';
            }

            $open = ReadyEpic::openChildren($epic)->orderBy('rank')->orderBy('id')->get();
            if ($open->isEmpty()) {
                return 'done';
            }

            $mark = hash('sha256', $open->pluck('id')->implode(','));
            if ($worked && $locked->epic_waiting !== $mark) {
                $locked->forceFill(['epic_waiting' => $mark])->save();
                AgentFlow::comment($bot, $epic, __('agents.comment.epic_waiting', ['children' => $open->pluck('key')->implode(', ')], AgentFlow::locale()));
            }

            return 'waiting';
        }, 3);

        return $outcome === 'done' ? ReadyEpic::run($actor, $thread) : $outcome;
    }

    /**
     * Opens the draft PR of the epic and notes it at the strand; the delivery `opened` that follows links it. A PR
     * GitHub refuses (no difference yet, one open already) or GitHub without an answer: the sweep tries again.
     */
    private static function openPr(AgentThread $thread): void
    {
        $link = ProjectRepository::query()->with('repository.installation.app')->where('project_id', $thread->project_id)->first();
        $epic = WorkItem::query()->find($thread->work_item_id);
        if ($link === null || $epic === null) {
            return;
        }

        try {
            $token = InstallationTokens::forLink($link, self::PERMISSIONS)['token'];
            $pr = GitHubApi::createPullRequest($token, $link->repository->full_name, (string) $thread->branch, (string) $thread->base_branch,
                "{$epic->key}: {$epic->title}", "Fixes {$epic->key}", true);
        } catch (GitHubUnavailable $e) {
            if ($e->status !== 422) {
                report(new RuntimeException("The PR of the epic strand {$thread->id} could not be opened.", 0, $e));
            }

            return;
        }

        if (is_int($pr['number'] ?? null)) {
            $head = is_array($pr['head'] ?? null) && is_string($pr['head']['sha'] ?? null) ? $pr['head']['sha'] : null;
            AgentThread::query()->whereKey($thread->id)->whereNull('pr_number')->update(['pr_number' => $pr['number'], 'pr_draft' => true, 'head_sha' => $head]);
        }
    }
}
