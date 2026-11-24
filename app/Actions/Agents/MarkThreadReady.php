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
 * Marks the draft PR of an epic ready once no child is open (spec 7.6, ReadyEpic), with a token of werkbuch; the
 * delivery `ready_for_review` that follows starts CI and review as for any PR.
 */
final class MarkThreadReady
{
    use AsAction;

    public const PERMISSIONS = ['pull_requests' => 'write'];

    /**
     * @throws GitHubUnavailable when GitHub does not answer or refuses (the job tries again)
     */
    public function handle(Actor $actor, string $threadId): string
    {
        $thread = AgentThread::query()->find($threadId);
        $link = $thread === null ? null : ProjectRepository::query()->with('repository.installation')->where('project_id', $thread->project_id)->first();
        if ($thread === null || $link === null || $thread->status !== AgentThread::OPEN || $thread->pr_number === null || ! $thread->pr_draft) {
            return 'stale';
        }

        $token = InstallationTokens::forLink($link, self::PERMISSIONS)['token'];
        $pr = GitHubApi::pullRequest($token, $link->repository->full_name, $thread->pr_number);
        if (($pr['draft'] ?? false) !== true || ! is_string($pr['node_id'] ?? null)) {
            return 'ready';
        }

        GitHubApi::markReady($token, $pr['node_id']);

        return 'marked';
    }
}
