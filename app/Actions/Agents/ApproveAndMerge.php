<?php

namespace App\Actions\Agents;

use App\Jobs\MergeAgentPullRequest;
use App\Models\AgentThread;
use App\Support\Actor;
use App\Support\AgentFlow;
use Illuminate\Support\Facades\DB;
use Lorisleiva\Actions\Concerns\AsAction;

/**
 * Decides the merge of the PR of a strand (spec 7.2): an approve of the review and a green CI on the same head commit,
 * a PR that is open and no draft. Under the lock of the strand, once per head commit (`merge_sha`): two who decide at
 * once (the end of the review, the last check) merge once (MergeDecisionRaceTest). The merge itself asks GitHub, in a job
 * after the commit (MergeThread). Answers whether it decided now.
 */
final class ApproveAndMerge
{
    use AsAction;

    public function handle(Actor $actor, AgentThread $thread): bool
    {
        return DB::transaction(function () use ($thread): bool {
            $locked = AgentThread::query()->lockForUpdate()->findOrFail($thread->id);
            $link = AgentFlow::linkOf($locked);

            if ($locked->status !== AgentThread::OPEN || $link === null || $locked->pr_draft || $link->state !== 'open'
                || $locked->head_sha === null || $locked->merge_sha === $locked->head_sha || $link->head_sha !== $locked->head_sha
                || $locked->review_sha !== $locked->head_sha || $locked->review_verdict !== 'approve' || AgentFlow::ci($link) !== 'success') {
                return false;
            }

            $head = (string) $locked->head_sha;
            $locked->forceFill(['merge_sha' => $head])->save();
            MergeAgentPullRequest::dispatch($locked->id, $head)->afterCommit();

            return true;
        }, 3);
    }
}
