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
 * Asks GitHub whether the PR of a strand still merges into its base (spec 7.1: after every push to the PR and to its
 * base branch; GitHub computes `mergeable` late: `pending`, the job looks again). A conflict (`dirty`) becomes a
 * `conflict` run before CI and review. Only reads GitHub; no HTTP under a lock.
 */
final class CheckThreadMergeability
{
    use AsAction;

    public const PERMISSIONS = ['pull_requests' => 'read'];

    /**
     * @throws GitHubUnavailable when GitHub does not answer (the job tries again)
     */
    public function handle(Actor $actor, string $threadId): string
    {
        $thread = AgentThread::query()->find($threadId);
        $link = $thread === null ? null : ProjectRepository::query()->with('repository.installation.app')->where('project_id', $thread->project_id)->first();
        if ($thread === null || $link === null || $thread->status !== AgentThread::OPEN || $thread->pr_number === null) {
            return 'stale';
        }

        $pr = GitHubApi::pullRequest(InstallationTokens::forLink($link, self::PERMISSIONS)['token'], $link->repository->full_name, $thread->pr_number);
        $head = is_array($pr['head'] ?? null) ? ($pr['head']['sha'] ?? null) : null;

        return match (true) {
            ($pr['state'] ?? null) !== 'open' || ! is_string($head) => 'closed',
            ($pr['mergeable'] ?? null) === null => 'pending',
            ($pr['mergeable_state'] ?? null) === 'dirty' => StartConflict::run($actor, $thread, $head) === null ? 'held' : 'conflict',
            default => 'clean',
        };
    }
}
