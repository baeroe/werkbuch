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
use App\Support\Actor;
use App\Support\AgentFlow;
use App\Support\AgentPullRequests;
use App\Support\ItemLock;
use Illuminate\Support\Facades\DB;
use Lorisleiva\Actions\Concerns\AsAction;

/**
 * A `pull_request` delivery of a PR of an agent (spec 7.2; SyncPullRequest linked it and answered `agent`): the strand
 * learns its PR (number, head commit, draft). A new head commit voids the decision to merge and cancels reviews of the
 * commit before (an approve frees only its own commit) and has GitHub asked whether the PR still merges. An open PR that
 * is no draft puts the item to „In Review“ (an epic only once werkbuch made its PR ready). Merged (by werkbuch or a
 * person) the strand is merged; closed without a merge it ends and the item goes to „Korrektur“. Deliveries out of order
 * change nothing a later one decided: a strand that ended stays.
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
        if (($pr['state'] ?? null) === 'closed') {
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
            $locked->forceFill([
                'pr_number' => $number, 'repository_github_id' => $repositoryId, 'head_sha' => $head['sha'], 'pr_draft' => $draft,
                'awaiting_pr_since' => null, 'merge_sha' => $moved ? null : $locked->merge_sha,
            ])->save();

            foreach ($runs->filter(fn (AgentRun $run) => $run->head_sha !== $head['sha']) as $stale) {
                CancelRun::stop($actor, $stale);
            }

            if (! $draft && $locked->status === AgentThread::OPEN && ! $item->type->is_epic) {
                AgentFlow::move(User::query()->findOrFail($locked->bot_id), $item, AgentStep::Review);
            }

            if ($moved) {
                CheckPullRequestMergeability::dispatch($locked->id)->afterCommit();
            }

            return $moved ? 'pushed' : 'updated';
        }, 3);

        return $outcome;
    }
}
