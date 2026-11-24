<?php

namespace App\Actions\Agents;

use App\Domain\Workflow\AgentStep;
use App\GitHub\GitHubApi;
use App\GitHub\GitHubUnavailable;
use App\GitHub\InstallationTokens;
use App\Models\AgentProjectSettings;
use App\Models\AgentThread;
use App\Models\ProjectRepository;
use App\Models\User;
use App\Models\WorkItem;
use App\Support\Actor;
use App\Support\AgentFlow;
use App\Support\OwnMerges;
use Illuminate\Support\Facades\DB;
use Lorisleiva\Actions\Concerns\AsAction;
use RuntimeException;

/**
 * werkbuch merges the PR of a strand (spec 7.2), from the job of the decision (ApproveAndMerge), with a short token of
 * its own: GitHub is asked first whether the PR can be merged (`mergeable` is `null` while it computes: `pending`, the
 * job looks again), a conflict becomes a `conflict` run. The merge goes at the head commit decided on (GitHub refuses
 * when the head moved); werkbuch notes it as its own before it asks (OwnMerges, so the push of the merge never wakes the
 * guard) and its commit after. Then the strand is merged (CompleteThread) and the branch goes. A merge GitHub refuses
 * otherwise (a ruleset that wants an approval) is a comment and „Korrektur“. No HTTP under a lock.
 */
final class MergeThread
{
    use AsAction;

    public const PERMISSIONS = ['contents' => 'write', 'pull_requests' => 'write'];

    /**
     * @throws GitHubUnavailable when GitHub does not answer (the job tries again)
     */
    public function handle(Actor $actor, string $threadId, string $sha): string
    {
        $thread = AgentThread::query()->find($threadId);
        $link = $thread === null ? null : ProjectRepository::query()->with('repository.installation')->where('project_id', $thread->project_id)->first();

        if ($thread === null || $link === null || $thread->status !== AgentThread::OPEN || $thread->merge_sha !== $sha || $thread->pr_number === null) {
            return 'stale';
        }

        $token = InstallationTokens::forLink($link, self::PERMISSIONS)['token'];
        $repository = $link->repository->full_name;
        $pr = GitHubApi::pullRequest($token, $repository, $thread->pr_number);
        $head = is_array($pr['head'] ?? null) ? ($pr['head']['sha'] ?? null) : null;

        if (($pr['state'] ?? null) !== 'open' || $head !== $sha) {
            self::forget($thread, $sha);

            return 'moved';
        }

        if (! array_key_exists('mergeable', $pr) || $pr['mergeable'] === null) {
            return 'pending';
        }

        if (($pr['mergeable_state'] ?? null) === 'dirty') {
            self::forget($thread, $sha);
            StartConflict::run($actor, $thread, $sha);

            return 'conflict';
        }

        $merge = DB::transaction(fn () => OwnMerges::expect($link->repository_id, (int) $thread->pr_number));
        try {
            $merged = GitHubApi::mergePullRequest($token, $repository, (int) $thread->pr_number, $sha, AgentProjectSettings::of($thread->project_id)->merge_method);
        } catch (GitHubUnavailable $e) {
            if ($e->transient()) {
                throw $e;
            }

            return self::refused($actor, $thread, $sha, $e);
        }

        DB::transaction(function () use ($actor, $merge, $merged, $thread): void {
            OwnMerges::merged($merge, $merged);
            CompleteThread::run($actor, $thread, 'merged');
        });

        try {
            GitHubApi::deleteBranch($token, $repository, (string) $thread->branch);
        } catch (GitHubUnavailable $e) {
            report(new RuntimeException("The branch of strand {$thread->id} could not be deleted after the merge.", 0, $e));
        }

        return 'merged';
    }

    /** The decision of a head commit is void: a new one may come. */
    private static function forget(AgentThread $thread, string $sha): void
    {
        AgentThread::query()->whereKey($thread->id)->where('merge_sha', $sha)->update(['merge_sha' => null]);
    }

    /** GitHub refused the merge: the head moved (409, a new head decides again), or it cannot merge (a comment). */
    private static function refused(Actor $actor, AgentThread $thread, string $sha, GitHubUnavailable $e): string
    {
        self::forget($thread, $sha);
        if ($e->status === 409) {
            return 'moved';
        }

        DB::transaction(function () use ($thread, $e): void {
            $bot = User::query()->findOrFail($thread->bot_id);
            $item = WorkItem::query()->findOrFail($thread->work_item_id);
            AgentFlow::comment($bot, $item, __('agents.comment.merge_refused', ['status' => (string) $e->status], AgentFlow::locale()));
            AgentFlow::move($bot, $item, AgentStep::Correction);
        }, 3);

        return 'refused';
    }
}
