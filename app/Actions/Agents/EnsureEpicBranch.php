<?php

namespace App\Actions\Agents;

use App\GitHub\GitHubApi;
use App\GitHub\GitHubUnavailable;
use App\GitHub\InstallationTokens;
use App\Models\AgentThread;
use App\Models\ProjectRepository;
use App\Support\Actor;
use Lorisleiva\Actions\Concerns\AsAction;

/**
 * The branch of an epic exists before a run of a child strand starts on it (WEBU-71): the runner makes the worktree of
 * the child from it. Made from the base of the project with a token of werkbuch when GitHub does not have it; only
 * reads and writes GitHub, after the commit of the claim (no HTTP under a lock).
 *
 * @throws GitHubUnavailable when GitHub does not answer or refuses (the claim gives the run back)
 */
final class EnsureEpicBranch
{
    use AsAction;

    public const PERMISSIONS = ['contents' => 'write'];

    public function handle(Actor $actor, AgentThread $child): string
    {
        $epic = $child->parent_thread_id === null ? null : AgentThread::query()->find($child->parent_thread_id);
        $link = $epic === null ? null : ProjectRepository::query()->with('repository.installation.app')->where('project_id', $epic->project_id)->first();
        if ($epic === null || $link === null || $epic->branch === null || $epic->base_branch === null) {
            return 'none';
        }

        $token = InstallationTokens::forLink($link, self::PERMISSIONS)['token'];
        $repository = $link->repository->full_name;
        if (GitHubApi::branchSha($token, $repository, $epic->branch) !== null) {
            return 'there';
        }

        $base = GitHubApi::branchSha($token, $repository, $epic->base_branch)
            ?? throw new GitHubUnavailable(GitHubUnavailable::GITHUB, "GitHub has no base branch {$epic->base_branch}.", 404);
        try {
            GitHubApi::createBranch($token, $repository, $epic->branch, $base);
        } catch (GitHubUnavailable $e) {
            if ($e->status !== 422) { // made meanwhile
                throw $e;
            }
        }

        return 'made';
    }
}
