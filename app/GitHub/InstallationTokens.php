<?php

namespace App\GitHub;

use App\Domain\GitHub\RepoPermissions;
use App\Models\AgentRun;
use App\Models\ProjectRepository;

/**
 * Installation tokens (spec 11.3): one per run, for the one repo of its project and the permissions of its kind
 * (RepoPermissions), valid an hour; werkbuch's own with RepoPermissions::OWN. Only GitHub knows a token after the call:
 * werkbuch never stores one, it goes into the answer of a claim or of `git-token` and nowhere else (no event, no job,
 * no log). Reads the database only; HTTP never under a lock (the callers ask before or after their transactions).
 */
final class InstallationTokens
{
    /**
     * The repo and a token for a run, null for a project without a repo.
     *
     * @return array{repo_url: string, token: string, expires_at: string}|null
     *
     * @throws GitHubUnavailable `unreachable` for a repo its app no longer reaches, `github` when GitHub refuses
     */
    public static function forRun(AgentRun $run): ?array
    {
        $link = ProjectRepository::query()->with('repository.installation.app')->where('project_id', $run->project_id)->first();

        return $link === null ? null : ['repo_url' => $link->repository->cloneUrl(), ...self::forLink($link, RepoPermissions::forRun($run->type))];
    }

    /**
     * A token for the repo of a project with these permissions, from the app whose installation reaches it (A680: one
     * app per GitHub account).
     *
     * @param  array<string, string>  $permissions
     * @return array{token: string, expires_at: string}
     */
    public static function forLink(ProjectRepository $link, array $permissions): array
    {
        $repository = $link->repository;
        $installation = $repository->installation;

        if ($repository->removed_at !== null || ! $installation->usable()) {
            throw new GitHubUnavailable(GitHubUnavailable::UNREACHABLE, "The app does not reach {$repository->full_name}.");
        }

        return GitHubApi::accessToken($installation->app, $installation->installation_id, [$repository->github_id], $permissions);
    }
}
