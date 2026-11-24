<?php

namespace App\Actions\Links;

use App\Domain\GitHub\CiState;
use App\GitHub\GitHubApi;
use App\GitHub\GitHubUnavailable;
use App\GitHub\InstallationTokens;
use App\Models\ProjectRepository;
use App\Models\WorkItemLink;
use App\Support\Actor;
use Lorisleiva\Actions\Concerns\AsAction;

/**
 * Reads the check runs of a commit from GitHub itself (A591): a `check_run` that came before the PR had that commit
 * as its head found no link and was passed over; GitHub still has it. Every run goes to the links of the commit as a
 * delivery would bring it (SyncChecks), then the links note that werkbuch asked (`checks_loaded_sha`, `_at`): a head
 * without any check run counts green only once GitHub said so after the commit settled (AgentFlow::ci). With a token
 * of its own, or with the one of the caller (MergeThread). No HTTP under a lock. Answers the CI state GitHub gave,
 * `ignored` for a repo no project has.
 */
final class LoadChecks
{
    use AsAction;

    public const PERMISSIONS = ['checks' => 'read'];

    /**
     * @throws GitHubUnavailable when GitHub does not answer or refuses (the job tries again)
     */
    public function handle(Actor $actor, int $repositoryGithubId, string $sha, ?string $token = null): string
    {
        $link = ProjectRepository::query()->with('repository.installation')->whereHas('repository', fn ($query) => $query->where('github_id', $repositoryGithubId))->first();
        if ($link === null) {
            return 'ignored';
        }

        $runs = GitHubApi::checkRuns($token ?? InstallationTokens::forLink($link, self::PERMISSIONS)['token'], $link->repository->full_name, $sha);
        foreach ($runs as $run) {
            SyncChecks::run($actor, ['check_run' => ['head_sha' => $sha, ...$run], 'repository' => ['id' => $repositoryGithubId]]);
        }

        WorkItemLink::query()->where('repository_github_id', $repositoryGithubId)->where('head_sha', $sha)
            ->update(['checks_loaded_sha' => $sha, 'checks_loaded_at' => now()]);

        return CiState::of(array_map(fn (array $run) => [
            'status' => is_string($run['status'] ?? null) ? $run['status'] : 'queued',
            'conclusion' => is_string($run['conclusion'] ?? null) ? $run['conclusion'] : null,
        ], $runs));
    }
}
