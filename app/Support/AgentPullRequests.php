<?php

namespace App\Support;

use App\Models\AgentThread;
use App\Models\GitHubApp;

/**
 * Which PRs belong to an agent (spec 12: „PRs eines Strangs folgen 7.2“): a PR the app opened (its author is the app's
 * bot account, `<slug>[bot]`: only runs push and open PRs with its tokens) or the PR of an open or paused strand of the
 * project in the same repo, by its number first, else by its head branch (A544). SyncPullRequest links them like any
 * PR and leaves what they set off to the flow of the agents (WEBU-26 hooks in where SyncPullRequest answers `agent`,
 * with the strand this names).
 */
final class AgentPullRequests
{
    /**
     * The strand of a PR of the project in its repo, null when none has it.
     */
    public static function threadOf(string $projectId, int $repositoryGithubId, int $number, string $headBranch): ?AgentThread
    {
        $strands = fn () => AgentThread::query()->where('project_id', $projectId)->where('repository_github_id', $repositoryGithubId)
            ->whereIn('status', [AgentThread::OPEN, AgentThread::PAUSED])->orderBy('id');

        return $strands()->where('pr_number', $number)->first() ?? $strands()->where('branch', $headBranch)->first();
    }

    /** Whether the PR is an agent's: opened by the app, or of a strand. */
    public static function isAgent(?AgentThread $thread, string $author): bool
    {
        $app = GitHubApp::current();

        return $thread !== null || ($app !== null && strcasecmp($author, $app->botLogin()) === 0);
    }
}
