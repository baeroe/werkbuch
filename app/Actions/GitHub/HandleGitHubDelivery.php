<?php

namespace App\Actions\GitHub;

use App\Actions\Agents\HandleAgentPullRequest;
use App\Actions\Agents\HandleCheckResult;
use App\Actions\Agents\StartReview;
use App\Actions\Links\SyncChecks;
use App\Actions\Links\SyncPullRequest;
use App\GitHub\GitHubUnavailable;
use App\Jobs\CheckPullRequestMergeability;
use App\Jobs\LoadPullRequestChecks;
use App\Models\AgentProjectSettings;
use App\Models\AgentThread;
use App\Models\GitHubApp;
use App\Models\GitHubDelivery;
use App\Models\ProjectRepository;
use App\Models\WorkItemLink;
use App\Support\Actor;
use App\Support\OwnMerges;
use Lorisleiva\Actions\Concerns\AsAction;

/**
 * Works one webhook delivery (spec 11.4) in the queue: `installation` and `installation_repositories` read GitHub
 * again (SyncGitHub::pull: the payloads carry no default branch), a `push` goes to the guard (DetectUnauthorizedPush),
 * `ping` is fine; a `pull_request` links the PR to its items (SyncPullRequest: `linked`, `agent` for a PR of an agent,
 * where the flow of WEBU-26 takes over), a `check_run` goes to the links of its commit (SyncChecks); a PR of an
 * agent and the CI of a commit go on into the flow of the agents (HandleAgentPullRequest, HandleCheckResult, WEBU-26), a
 * completed `check_suite` too; a push to the base branch has the PRs of agents checked for conflicts.
 * The outcome is kept on the row; a delivery worked once is never worked again. A push the guard cannot judge yet
 * (`pending`) stays open: the job looks again later. Answers the outcome, null for a delivery worked already.
 */
final class HandleGitHubDelivery
{
    use AsAction;

    /** The actions of a `pull_request` after which its head may be a commit werkbuch has no check runs of yet. */
    public const NEW_HEAD = ['opened', 'reopened', 'synchronize', 'ready_for_review'];

    /**
     * @throws GitHubUnavailable when GitHub does not answer the sync (the job tries again)
     */
    public function handle(Actor $actor, string $deliveryId): ?string
    {
        $delivery = GitHubDelivery::query()->find($deliveryId);
        if ($delivery === null || $delivery->processed_at !== null) {
            return null;
        }

        $app = GitHubApp::current();
        $outcome = match (true) {
            $app === null => 'ignored',
            in_array($delivery->event, ['installation', 'installation_repositories'], true) => self::sync($app),
            $delivery->event === 'push' => self::push($actor, $delivery->data()),
            $delivery->event === 'pull_request' => self::pullRequest($actor, $delivery->data()),
            $delivery->event === 'check_run' => self::checks($actor, $delivery->data(), SyncChecks::run($actor, $delivery->data()), 'check_run'),
            $delivery->event === 'check_suite' => self::checks($actor, $delivery->data(), 'ok', 'check_suite'),
            $delivery->event === 'ping' => 'ok',
            default => 'ignored',
        };

        if ($outcome !== OwnMerges::PENDING) {
            GitHubDelivery::query()->whereKey($delivery->id)->whereNull('processed_at')->update(['processed_at' => now(), 'outcome' => $outcome]);
        }

        return $outcome;
    }

    /**
     * A push to the base branch of a project may make PRs of agents conflict: GitHub is asked again for each (spec 7.1).
     *
     * @param  array<array-key, mixed>  $payload
     */
    private static function push(Actor $actor, array $payload): string
    {
        $outcome = DetectUnauthorizedPush::run($actor, $payload);
        $repositoryId = is_array($payload['repository'] ?? null) ? ($payload['repository']['id'] ?? null) : null;
        $ref = $payload['ref'] ?? null;

        if ($outcome !== OwnMerges::PENDING && is_int($repositoryId) && is_string($ref)) {
            $link = ProjectRepository::query()->whereHas('repository', fn ($query) => $query->where('github_id', $repositoryId))->first();
            if ($link !== null && $ref === 'refs/heads/'.$link->base_branch) {
                AgentThread::query()->where('project_id', $link->project_id)->where('status', AgentThread::OPEN)->whereNotNull('pr_number')->orderBy('id')->pluck('id')
                    ->each(fn (string $thread) => CheckPullRequestMergeability::dispatch($thread));
            }
        }

        return $outcome;
    }

    /**
     * A PR of an agent goes on into the flow of the agents (spec 7.2) once it is linked.
     *
     * @param  array<array-key, mixed>  $payload
     */
    private static function pullRequest(Actor $actor, array $payload): string
    {
        $outcome = SyncPullRequest::run($actor, $payload);
        if ($outcome === 'agent') {
            HandleAgentPullRequest::run($actor, $payload);
        }

        $pr = is_array($payload['pull_request'] ?? null) ? $payload['pull_request'] : [];
        $sha = is_array($pr['head'] ?? null) ? ($pr['head']['sha'] ?? null) : null;
        $repositoryId = is_array($payload['repository'] ?? null) ? ($payload['repository']['id'] ?? null) : null;
        $link = $outcome === 'ignored' || ! is_int($repositoryId) || ! is_string($sha) ? null
            : ProjectRepository::query()->with('project')->whereHas('repository', fn ($query) => $query->where('github_id', $repositoryId))->first();

        if ($link !== null && ($pr['state'] ?? null) === 'open') {
            // a person's PR: a review by the agent of the project cancels when its PR moves on (A596)
            if ($outcome === 'linked' && is_int($pr['number'] ?? null)) {
                StartReview::cancelStale($actor, $repositoryId, $pr['number'], $sha);
            }

            // the check runs of a new head that came before the PR had it (A591), where the flow reads them
            if (in_array($payload['action'] ?? null, self::NEW_HEAD, true)
                && ($outcome === 'agent' || (AgentProjectSettings::of($link->project_id)->review_person_prs && StartReview::reviewer($link->project, null) !== null))) {
                LoadPullRequestChecks::dispatch($repositoryId, $sha);
            }
        }

        return $outcome;
    }

    /**
     * A check run or check suite of a head commit: the CI of its PRs may have changed (spec 7.2). A suite counts once it
     * completed; its runs come as check runs of their own.
     *
     * @param  array<array-key, mixed>  $payload
     */
    private static function checks(Actor $actor, array $payload, string $outcome, string $event): string
    {
        $source = is_array($payload[$event] ?? null) ? $payload[$event] : [];
        $repositoryId = is_array($payload['repository'] ?? null) ? ($payload['repository']['id'] ?? null) : null;
        $sha = $source['head_sha'] ?? null;

        if ($outcome === 'ignored' || ! is_int($repositoryId) || ! is_string($sha) || ($event === 'check_suite' && ($payload['action'] ?? null) !== 'completed')) {
            return $event === 'check_suite' ? 'ignored' : $outcome;
        }

        HandleCheckResult::run($actor, $repositoryId, $sha);

        // a suite of GitHub Actions completed: its workflow runs, which werkbuch saw waiting, may have ended (A608, A610)
        $app = is_array($source['app'] ?? null) ? ($source['app']['slug'] ?? null) : null;
        if ($event === 'check_suite' && $app === 'github-actions' && WorkItemLink::query()->where('repository_github_id', $repositoryId)->where('head_sha', $sha)
            ->where('state', WorkItemLink::OPEN)->whereHas('checks', fn ($checks) => $checks->where('kind', 'workflow')->where('status', '!=', 'completed')->where('head_sha', $sha))->exists()) {
            LoadPullRequestChecks::dispatch($repositoryId, $sha);
        }

        return $outcome;
    }

    private static function sync(GitHubApp $app): string
    {
        SyncGitHub::pull($app);

        return 'synced';
    }
}
