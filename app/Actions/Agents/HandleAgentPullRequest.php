<?php

namespace App\Actions\Agents;

use App\Actions\AgentRuns\CancelRun;
use App\Domain\Agents\RunType;
use App\Domain\Workflow\AgentStep;
use App\Jobs\CheckPullRequestMergeability;
use App\Models\AgentRun;
use App\Models\AgentThread;
use App\Models\ProjectRepository;
use App\Models\User;
use App\Models\WorkItem;
use App\Models\WorkItemLink;
use App\Support\Actor;
use App\Support\AgentFlow;
use App\Support\AgentPullRequests;
use App\Support\ItemLock;
use App\Support\OwnMerges;
use Carbon\CarbonImmutable;
use Illuminate\Support\Facades\DB;
use Lorisleiva\Actions\Concerns\AsAction;

/**
 * A `pull_request` delivery of a PR of an agent (spec 7.2; SyncPullRequest linked it and answered `agent`): the strand
 * learns its PR (number, head commit, draft). A new head commit voids the decision to merge and cancels reviews of the
 * commit before (an approve frees only its own commit) and has GitHub asked whether the PR still merges. An open PR that
 * is no draft puts the item to „In Review“ (an epic only once werkbuch made its PR ready). Merged (by werkbuch or a
 * person) the strand is merged (a merge werkbuch asked for is settled as its own, A600); a draft that became ready has
 * the CI of its head looked at (GitHub runs none for that); closed without a merge it ends and the item goes to „Korrektur“. Deliveries out of order
 * change nothing a later one decided: a strand that ended stays, and a delivery older than the newest the links know
 * (`pr_updated_at`) sets neither head nor draft back.
 */
final class HandleAgentPullRequest
{
    use AsAction;

    /**
     * @param  array<array-key, mixed>  $payload
     */
    public function handle(Actor $actor, array $payload): string
    {
        $pr = is_array($payload['pull_request'] ?? null) ? $payload['pull_request'] : [];
        $repositoryId = is_array($payload['repository'] ?? null) ? ($payload['repository']['id'] ?? null) : null;
        $head = is_array($pr['head'] ?? null) ? $pr['head'] : [];
        $number = $pr['number'] ?? null;
        $link = is_int($repositoryId) ? ProjectRepository::query()->whereHas('repository', fn ($query) => $query->where('github_id', $repositoryId))->first() : null;

        if ($link === null || ! is_int($number) || ! is_string($head['sha'] ?? null) || ! is_string($head['ref'] ?? null)) {
            return 'ignored';
        }

        $thread = AgentPullRequests::threadOf($link->project_id, $repositoryId, $number, $head['ref']);
        if ($thread === null) {
            return 'ignored';
        }

        $merged = ($pr['merged'] ?? false) === true || is_string($pr['merged_at'] ?? null);

        // a delivery older than what the links of the PR know (A550) sets no older head or draft back; a merge stays one
        $newest = WorkItemLink::query()->where('repository_github_id', $repositoryId)->where('number', $number)->max('pr_updated_at');
        if (! $merged && is_string($pr['updated_at'] ?? null) && is_string($newest) && CarbonImmutable::parse($pr['updated_at'])->lt(CarbonImmutable::parse($newest))) {
            return 'stale';
        }
        if (($pr['state'] ?? null) === 'closed') {
            // GitHub tells of a merge werkbuch asked for before its answer came, or instead of it (A600): the push of the
            // merge is werkbuch's own
            if ($merged && is_string($pr['merge_commit_sha'] ?? null)) {
                OwnMerges::settle($link->repository_id, $number, $pr['merge_commit_sha']);
            }
            CompleteThread::run($actor, $thread, $merged ? 'merged' : 'closed');

            return $merged ? 'merged' : 'closed';
        }

        $draft = ($pr['draft'] ?? false) === true;
        $outcome = DB::transaction(function () use ($actor, $thread, $number, $repositoryId, $head, $draft): string {
            $item = WorkItem::query()->findOrFail($thread->work_item_id);
            ItemLock::take($item);
            $runs = AgentFlow::openRuns($thread, RunType::Review);
            $locked = AgentThread::query()->lockForUpdate()->findOrFail($thread->id);
            if ($locked->status !== AgentThread::OPEN && $locked->status !== AgentThread::PAUSED) {
                return 'ended';
            }

            $moved = $locked->head_sha !== $head['sha'];
            $readied = $locked->pr_draft && ! $draft;
            $locked->forceFill([
                'pr_number' => $number, 'repository_github_id' => $repositoryId, 'head_sha' => $head['sha'], 'pr_draft' => $draft,
                'awaiting_pr_since' => null, 'merge_sha' => $moved ? null : $locked->merge_sha,
                'pushed_sha' => $moved ? null : $locked->pushed_sha, 'pushed_at' => $moved ? null : $locked->pushed_at,
            ])->save();

            foreach ($runs->filter(fn (AgentRun $run) => $run->head_sha !== $head['sha']) as $stale) {
                CancelRun::stop($actor, $stale);
            }

            // the end of a run that changes code moves the item itself (A593): a push of it in between moves nothing
            if (! $draft && $locked->status === AgentThread::OPEN && ! $item->type->is_epic && ! AgentFlow::coding($locked)) {
                AgentFlow::move(User::query()->findOrFail($locked->bot_id), $item, AgentStep::Review);
            }

            if ($moved) {
                CheckPullRequestMergeability::dispatch($locked->id)->afterCommit();
            }

            return $moved ? 'pushed' : ($readied ? 'readied' : 'updated');
        }, 3);

        // ready for review: GitHub runs no CI again for that, the CI of the head counts now (A594)
        if ($outcome === 'readied') {
            HandleCheckResult::run($actor, $repositoryId, $head['sha']);
        }

        return $outcome;
    }
}
