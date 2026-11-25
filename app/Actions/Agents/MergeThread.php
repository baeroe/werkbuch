<?php

namespace App\Actions\Agents;

use App\Actions\Links\LoadChecks;
use App\Domain\GitHub\CiState;
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
 * job looks again), a conflict becomes a `conflict` run, the guard of the project or a CI that GitHub does not have
 * green (its check runs read again, A591) stops it. The merge goes at the head commit decided on (GitHub refuses
 * when the head moved); werkbuch notes it as its own before it asks (OwnMerges, so the push of the merge never wakes the
 * guard) and its commit after. Then the strand is merged (CompleteThread) and the branch goes. A merge GitHub refuses
 * otherwise (a ruleset that wants an approval) is a comment and „Korrektur“. When the answer to a merge got lost, the
 * next attempt finds the PR merged at that head and finishes (A600). No HTTP under a lock.
 */
final class MergeThread
{
    use AsAction;

    public const PERMISSIONS = ['contents' => 'write', 'pull_requests' => 'write', 'checks' => 'read', 'actions' => 'read', 'statuses' => 'read'];

    /**
     * @throws GitHubUnavailable when GitHub does not answer (the job tries again)
     */
    public function handle(Actor $actor, string $threadId, string $sha): string
    {
        $thread = AgentThread::query()->find($threadId);
        $link = $thread === null ? null : ProjectRepository::query()->with('repository.installation.app')->where('project_id', $thread->project_id)->first();

        // a strand merged meanwhile at this head (GitHub told of the merge before its answer came) still settles it
        $settles = $thread !== null && $thread->status === AgentThread::MERGED && $thread->merge_sha === $sha;
        if ($thread === null || $link === null || ($thread->status !== AgentThread::OPEN && ! $settles) || $thread->merge_sha !== $sha || $thread->pr_number === null) {
            return 'stale';
        }

        // the guard against an unauthorized merge holds the project: nothing merges (spec 11.3)
        if ($link->guarded() && ! $settles) {
            self::forget($thread, $sha);

            return 'guarded';
        }

        $token = InstallationTokens::forLink($link, self::PERMISSIONS)['token'];
        $repository = $link->repository->full_name;
        $pr = GitHubApi::pullRequest($token, $repository, $thread->pr_number);
        $head = is_array($pr['head'] ?? null) ? ($pr['head']['sha'] ?? null) : null;

        // the answer to a merge of this head got lost (A600): GitHub has it merged, werkbuch finishes what it began
        if (($pr['merged'] ?? false) === true && $head === $sha) {
            return self::finish($actor, $thread, $link, $token, is_string($pr['merge_commit_sha'] ?? null) ? $pr['merge_commit_sha'] : null);
        }

        if ($settles || ($pr['state'] ?? null) !== 'open' || $head !== $sha) {
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

        // the CI of the head as GitHub has it now, not only what reached werkbuch (A591): not green, no merge
        $ci = LoadChecks::run($actor, (int) $thread->repository_github_id, $sha, $token);
        if ($ci !== CiState::SUCCESS && $ci !== CiState::NONE) {
            self::forget($thread, $sha);
            HandleCheckResult::run($actor, (int) $thread->repository_github_id, $sha);

            return 'ci';
        }

        $merge = DB::transaction(fn () => OwnMerges::expect($link->repository_id, (int) $thread->pr_number), 3);
        try {
            $merged = GitHubApi::mergePullRequest($token, $repository, (int) $thread->pr_number, $sha, AgentProjectSettings::of($thread->project_id)->merge_method);
        } catch (GitHubUnavailable $e) {
            if ($e->transient()) {
                throw $e;
            }

            return self::refused($actor, $thread, $sha, $e);
        }

        DB::transaction(fn () => OwnMerges::merged($merge, $merged), 3);

        return self::finish($actor, $thread, $link, $token, null);
    }

    /** The PR is merged: a merge without its commit is settled from GitHub's word, the strand merged, the branch gone. */
    private static function finish(Actor $actor, AgentThread $thread, ProjectRepository $link, string $token, ?string $commit): string
    {
        DB::transaction(function () use ($actor, $thread, $link, $commit): void {
            if ($commit !== null) {
                OwnMerges::settle($link->repository_id, (int) $thread->pr_number, $commit);
            }
            CompleteThread::run($actor, $thread, 'merged');
        }, 3);

        try {
            GitHubApi::deleteBranch($token, $link->repository->full_name, (string) $thread->branch);
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
