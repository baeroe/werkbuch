<?php

namespace App\Actions\Agents;

use App\Domain\Workflow\AgentStep;
use App\Jobs\LoadPullRequestChecks;
use App\Models\AgentRun;
use App\Models\AgentThread;
use App\Models\Project;
use App\Models\User;
use App\Models\WorkItem;
use App\Models\WorkItemLink;
use App\Support\Actor;
use App\Support\AgentFlow;
use App\Support\ItemLock;
use Illuminate\Support\Facades\DB;
use Lorisleiva\Actions\Concerns\AsAction;

/**
 * Every minute (spec 7.2): an epic on its own branch with no child at work goes on (AdvanceEpic, WEBU-71); a strand whose task ended two minutes ago without a PR never got one (a comment and
 * „Korrektur“), nor did a commit a run reported five minutes ago reach its PR (A610: committed, not pushed); for a PR whose head commit came two minutes ago without any check GitHub is asked for its check runs
 * (LoadPullRequestChecks, A591: only a commit GitHub has none for counts green), and again for one whose workflow runs or
 * commit statuses still waited when GitHub was last asked (A608). Looks back a day at most, the oldest first. Answers how
 * many it handled.
 */
final class SweepAgentThreads
{
    use AsAction;

    public function handle(Actor $actor): int
    {
        $settled = now()->subMinutes(AgentFlow::SETTLE_MINUTES);
        $count = 0;

        foreach (AgentThread::query()->where('status', AgentThread::OPEN)->whereNull('pr_number')->where('awaiting_pr_since', '<=', $settled)
            ->orderBy('awaiting_pr_since')->orderBy('id')->limit(200)->get() as $thread) {
            $count += self::noPr($thread);
        }

        // a run reported a commit the PR never got (committed, not pushed, A610)
        foreach (AgentThread::query()->where('status', AgentThread::OPEN)->whereNotNull('pushed_sha')->where('pushed_at', '<=', now()->subMinutes(self::PUSH_MINUTES))
            ->orderBy('pushed_at')->orderBy('id')->limit(200)->get() as $thread) {
            $count += self::noPush($thread);
        }

        // an epic on its own branch with no child at work: its next child, its PR, or ready (WEBU-71)
        foreach (AgentThread::query()->where('status', AgentThread::OPEN)->where('per_child', true)->whereNull('ready_requested_at')
            ->whereIn('project_id', Project::query()->whereNull('deleting_at')->select('id'))
            ->whereNotExists(fn ($child) => $child->selectRaw('1')->from('agent_threads as children')->whereColumn('children.parent_thread_id', 'agent_threads.id')
                ->where('children.status', AgentThread::OPEN))
            ->orderBy('id')->limit(200)->pluck('id') as $epic) {
            $count += in_array(AdvanceEpic::run($actor, $epic), ['stale', 'working', 'waiting'], true) ? 0 : 1;
        }

        // an epic by rule A that stands with no run while a child it never tried waits (WEBU-72): the next child
        foreach (AgentThread::query()->where('status', AgentThread::OPEN)->where('per_child', false)->whereNull('ready_requested_at')
            ->whereIn('project_id', Project::query()->whereNull('deleting_at')->select('id'))
            ->whereExists(fn ($epic) => $epic->selectRaw('1')->from('work_items')->join('work_item_types', 'work_item_types.id', '=', 'work_items.type_id')
                ->whereColumn('work_items.id', 'agent_threads.work_item_id')->whereColumn('work_items.assignee_id', 'agent_threads.bot_id')->where('work_item_types.is_epic', true))
            ->whereExists(fn ($runs) => $runs->selectRaw('1')->from('agent_runs')->whereColumn('agent_runs.thread_id', 'agent_threads.id'))
            ->whereNotExists(fn ($runs) => $runs->selectRaw('1')->from('agent_runs')->whereColumn('agent_runs.thread_id', 'agent_threads.id')
                ->where(fn ($recent) => $recent->whereNull('agent_runs.finished_at')->orWhere('agent_runs.finished_at', '>', $settled)))
            ->orderBy('id')->limit(200)->get() as $thread) {
            $count += self::stalledEpic($actor, $thread);
        }

        // a head without any check: GitHub is asked once more after it settled (A591), only that may count it green
        $quiet = WorkItemLink::query()->selectRaw('repository_github_id, head_sha, min(head_seen_at) as seen')->where('state', WorkItemLink::OPEN)->where('draft', false)
            ->whereBetween('head_seen_at', [now()->subDay(), $settled])
            ->where(fn ($unasked) => $unasked->whereNull('checks_loaded_at')->orWhereColumn('checks_loaded_sha', '!=', 'head_sha')
                ->orWhereRaw('checks_loaded_at < head_seen_at + interval '.AgentFlow::SETTLE_MINUTES.' minute'))
            ->whereNotExists(fn ($checks) => $checks->selectRaw('1')->from('work_item_link_checks')->whereColumn('work_item_link_checks.work_item_link_id', 'work_item_links.id')
                ->whereColumn('work_item_link_checks.head_sha', 'work_item_links.head_sha'))
            ->groupBy('repository_github_id', 'head_sha')->orderBy('seen')->limit(200)->get();
        foreach ($quiet as $link) {
            LoadPullRequestChecks::dispatch((int) $link->repository_github_id, (string) $link->head_sha);
            $count++;
        }

        // a workflow run or a commit status that waited when GitHub was asked: no delivery says when it ends (A608)
        $waiting = WorkItemLink::query()->selectRaw('repository_github_id, head_sha, min(checks_loaded_at) as loaded')->where('state', WorkItemLink::OPEN)->where('draft', false)
            ->whereColumn('checks_loaded_sha', 'head_sha')->whereBetween('checks_loaded_at', [now()->subDay(), $settled])
            ->whereExists(fn ($checks) => $checks->selectRaw('1')->from('work_item_link_checks')->whereColumn('work_item_link_checks.work_item_link_id', 'work_item_links.id')
                ->whereColumn('work_item_link_checks.head_sha', 'work_item_links.head_sha')->whereIn('kind', ['workflow', 'status'])->where('work_item_link_checks.status', '!=', 'completed'))
            ->groupBy('repository_github_id', 'head_sha')->orderBy('loaded')->limit(200)->get();
        foreach ($waiting as $link) {
            LoadPullRequestChecks::dispatch((int) $link->repository_github_id, (string) $link->head_sha);
            $count++;
        }

        return $count;
    }

    /** The next child of an epic by rule A that stands, only one the strand never tried (a failed one waits for a person). */
    public static function stalledEpic(Actor $actor, AgentThread $thread): int
    {
        $epic = WorkItem::query()->findOrFail($thread->work_item_id);
        $next = StartTask::nextChild($thread, $epic, User::query()->findOrFail($thread->bot_id));
        if ($next === null || AgentRun::query()->where('thread_id', $thread->id)->where('work_item_id', $next->id)->exists()) {
            return 0;
        }

        return HandleRunResult::continueEpic($actor, $thread) === 'next_child' ? 1 : 0;
    }

    /** How long a commit a run reported may take to reach the PR. */
    public const PUSH_MINUTES = 5;

    /** A commit a run reported that never reached the PR: a comment and „Korrektur“; read again under its lock. */
    public static function noPush(AgentThread $thread): int
    {
        return DB::transaction(function () use ($thread): int {
            $item = WorkItem::query()->findOrFail($thread->work_item_id);
            ItemLock::take($item);
            [, $locked] = AgentFlow::lockStrand($thread);
            if ($locked->pushed_sha === null || $locked->pushed_at === null || $locked->pushed_at->gt(now()->subMinutes(self::PUSH_MINUTES))) {
                return 0;
            }

            $sha = $locked->pushed_sha;
            $locked->forceFill(['pushed_sha' => null, 'pushed_at' => null])->save();
            $bot = User::query()->findOrFail($locked->bot_id);
            AgentFlow::comment($bot, $item, __('agents.comment.no_push', ['sha' => substr($sha, 0, 7)], AgentFlow::locale()));
            AgentFlow::move($bot, $item, AgentStep::Correction);

            return 1;
        }, 3);
    }

    /** A strand without a PR two minutes after its task: a comment and „Korrektur“; read again under its lock. */
    public static function noPr(AgentThread $thread): int
    {
        return DB::transaction(function () use ($thread): int {
            $item = WorkItem::query()->findOrFail($thread->work_item_id);
            ItemLock::take($item);
            $locked = AgentThread::query()->lockForUpdate()->findOrFail($thread->id);
            if ($locked->pr_number !== null || $locked->awaiting_pr_since === null) {
                return 0;
            }

            $locked->forceFill(['awaiting_pr_since' => null])->save();
            $bot = User::query()->findOrFail($locked->bot_id);
            AgentFlow::comment($bot, $item, __('agents.comment.no_pr', [], AgentFlow::locale()));
            AgentFlow::move($bot, $item, AgentStep::Correction);

            return 1;
        }, 3);
    }
}
