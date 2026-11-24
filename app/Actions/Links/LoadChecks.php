<?php

namespace App\Actions\Links;

use App\Domain\GitHub\CiState;
use App\GitHub\GitHubApi;
use App\GitHub\GitHubUnavailable;
use App\GitHub\InstallationTokens;
use App\Models\ProjectRepository;
use App\Models\WorkItemLink;
use App\Models\WorkItemLinkCheck;
use App\Support\Actor;
use Illuminate\Support\Facades\DB;
use Lorisleiva\Actions\Concerns\AsAction;

/**
 * Reads the CI of a commit from GitHub itself (A591, A608): its check runs (a `check_run` that came before the PR had
 * that commit as its head found no link and was passed over; GitHub still has it), its workflow runs of GitHub Actions
 * (one that waits for a concurrency group or the approval of an environment has no check run yet) and its commit
 * statuses (CI that reports through the status API). Every check run goes to the links of the commit as a delivery
 * would bring it (SyncChecks); workflow runs and statuses replace what the links kept of them (kinds `workflow`,
 * `status`: a waiting run is pending, a failed one or a status `failure`/`error` red). Then the links note that werkbuch
 * asked (`checks_loaded_sha`, `_at`): a head without any of the three counts green only once GitHub said so after the
 * commit settled (AgentFlow::ci). With a token of its own, or with the one of the caller (MergeThread). No HTTP under a
 * lock. Answers the CI state GitHub gave, `ignored` for a repo no project has.
 */
final class LoadChecks
{
    use AsAction;

    public const PERMISSIONS = ['checks' => 'read', 'actions' => 'read', 'statuses' => 'read'];

    /** The states of a commit status that hold a PR back, and the one that waits. */
    private const STATUS_FAILED = ['failure', 'error'];

    /**
     * @throws GitHubUnavailable when GitHub does not answer or refuses (the job tries again)
     */
    public function handle(Actor $actor, int $repositoryGithubId, string $sha, ?string $token = null): string
    {
        $link = ProjectRepository::query()->with('repository.installation')->whereHas('repository', fn ($query) => $query->where('github_id', $repositoryGithubId))->first();
        if ($link === null) {
            return 'ignored';
        }

        $token ??= InstallationTokens::forLink($link, self::PERMISSIONS)['token'];
        $name = $link->repository->full_name;
        $runs = GitHubApi::checkRuns($token, $name, $sha);
        $workflows = array_values(array_filter(array_map(fn (array $run) => self::row('workflow', $run, $sha), GitHubApi::workflowRuns($token, $name, $sha))));
        $statuses = array_values(array_filter(array_map(fn (array $status) => self::row('status', $status, $sha), GitHubApi::statuses($token, $name, $sha))));

        foreach ($runs as $run) {
            SyncChecks::run($actor, ['check_run' => ['head_sha' => $sha, ...$run], 'repository' => ['id' => $repositoryGithubId]]);
        }

        DB::transaction(function () use ($repositoryGithubId, $sha, $workflows, $statuses): void {
            $links = WorkItemLink::query()->where('repository_github_id', $repositoryGithubId)->where('head_sha', $sha)->orderBy('id')->lockForUpdate()->get();
            foreach ($links as $of) {
                WorkItemLinkCheck::query()->where('work_item_link_id', $of->id)->whereIn('kind', ['workflow', 'status'])->delete();
                foreach ([...$workflows, ...$statuses] as $row) {
                    WorkItemLinkCheck::query()->create(['work_item_link_id' => $of->id, ...$row]);
                }
                $of->forceFill(['checks_loaded_sha' => $sha, 'checks_loaded_at' => now()])->save();
            }
        }, 3);

        return CiState::of([
            ...array_map(fn (array $run) => [
                'status' => is_string($run['status'] ?? null) ? $run['status'] : 'queued',
                'conclusion' => is_string($run['conclusion'] ?? null) ? $run['conclusion'] : null,
            ], $runs),
            ...array_map(fn (array $row) => ['status' => $row['status'], 'conclusion' => $row['conclusion']], [...$workflows, ...$statuses]),
        ]);
    }

    /**
     * A workflow run or a commit status as a row of the checks of a link: a status `pending` runs, `success` passed,
     * `failure` and `error` failed; a workflow run keeps its status and conclusion. Null for what GitHub sent malformed.
     *
     * @param  array<string, mixed>  $from
     * @return array{kind: string, check_run_id: int, name: string, app: ?string, status: string, conclusion: ?string, url: ?string, head_sha: string}|null
     */
    private static function row(string $kind, array $from, string $sha): ?array
    {
        $name = $kind === 'workflow' ? ($from['name'] ?? null) : ($from['context'] ?? null);
        if (! is_int($from['id'] ?? null) || ! is_string($name)) {
            return null;
        }

        if ($kind === 'workflow') {
            $status = is_string($from['status'] ?? null) ? $from['status'] : 'queued';
            $conclusion = is_string($from['conclusion'] ?? null) ? $from['conclusion'] : null;
            $url = $from['html_url'] ?? null;
        } else {
            $state = $from['state'] ?? null;
            $status = $state === 'success' || in_array($state, self::STATUS_FAILED, true) ? 'completed' : 'in_progress';
            $conclusion = $state === 'success' ? 'success' : (in_array($state, self::STATUS_FAILED, true) ? 'failure' : null);
            $url = $from['target_url'] ?? null;
        }

        return [
            'kind' => $kind,
            'check_run_id' => $from['id'],
            'name' => mb_substr($name, 0, 255),
            'app' => $kind === 'workflow' ? 'GitHub Actions' : null,
            'status' => mb_substr($status, 0, 16),
            'conclusion' => $conclusion === null ? null : mb_substr($conclusion, 0, 20),
            'url' => is_string($url) ? mb_substr($url, 0, 2048) : null,
            'head_sha' => $sha,
        ];
    }
}
