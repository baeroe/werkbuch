<?php

namespace App\Support;

use App\Models\AgentThread;
use App\Models\GitHubApp;

/**
 * Which PRs belong to an agent (spec 12: „PRs eines Strangs folgen 7.2“): a PR the app of its repo opened (its author is the
 * app's bot account, `<slug>[bot]`, A680: only runs push and open PRs with its tokens) or the PR of an open or paused strand of the
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

    /** Whether the PR is an agent's: of a strand, or opened by the app whose installation reaches its repo (A680). */
    public static function isAgent(?AgentThread $thread, string $author, int $repositoryGithubId): bool
    {
        return $thread !== null || self::byBot($author, self::botOf($repositoryGithubId));
    }

    /** The bot account of the app whose installation reaches the repo (`<slug>[bot]`), null when none does. */
    public static function botOf(int $repositoryGithubId): ?string
    {
        return GitHubApp::ofRepository($repositoryGithubId)?->botLogin();
    }

    /** Whether the author is that bot (GitHub logins are case-insensitive). */
    public static function byBot(string $author, ?string $bot): bool
    {
        return $bot !== null && strcasecmp($author, $bot) === 0;
    }
}
