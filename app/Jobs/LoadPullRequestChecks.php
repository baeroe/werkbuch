<?php

namespace App\Jobs;

use App\Actions\Agents\HandleCheckResult;
use App\Actions\Links\LoadChecks;
use App\Models\User;
use App\Support\Actor;
use Illuminate\Contracts\Queue\ShouldBeUnique;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Foundation\Queue\Queueable;

/**
 * Reads the check runs of a head commit of a PR from GitHub (A591: when the PR got that head, and once the commit
 * settled without any check), then lets the flow look at its CI (HandleCheckResult). Only the GitHub ID of the repo and
 * the commit; one per commit at a time.
 */
final class LoadPullRequestChecks implements ShouldBeUnique, ShouldQueue
{
    use Queueable;

    public int $tries = 5;

    public int $uniqueFor = 60;

    /** @var list<int> */
    public array $backoff = [30, 120, 300];

    public function __construct(public readonly int $repositoryGithubId, public readonly string $sha) {}

    public function uniqueId(): string
    {
        return "{$this->repositoryGithubId}:{$this->sha}";
    }

    public function handle(): void
    {
        $actor = Actor::system(User::defaultBot(), 'agents');
        if (LoadChecks::run($actor, $this->repositoryGithubId, $this->sha) !== 'ignored') {
            HandleCheckResult::run($actor, $this->repositoryGithubId, $this->sha);
        }
    }
}
