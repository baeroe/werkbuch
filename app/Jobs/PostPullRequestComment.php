<?php

namespace App\Jobs;

use App\Actions\Links\PostLinkback;
use App\Models\User;
use App\Support\Actor;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Foundation\Queue\Queueable;
use Illuminate\Queue\Middleware\WithoutOverlapping;

/**
 * Writes the comment of werkbuch at a PR (spec 12) after the links of the PR changed, on the default queue with only
 * the repo and the number: the text comes from the links as they are when it runs. Comments at one PR go one at a time
 * (the second waits for the first and then only updates); GitHub not answering is tried again with the backoff.
 */
final class PostPullRequestComment implements ShouldQueue
{
    use Queueable;

    public int $tries = 10;

    /** @var list<int> */
    public array $backoff = [30, 120, 300, 900];

    public function __construct(public readonly int $repositoryGithubId, public readonly int $number) {}

    /**
     * @return list<object>
     */
    public function middleware(): array
    {
        return [(new WithoutOverlapping("pr-comment:{$this->repositoryGithubId}:{$this->number}"))->releaseAfter(15)->expireAfter(120)];
    }

    public function handle(): void
    {
        PostLinkback::run(Actor::system(User::defaultBot(), 'pr_link'), $this->repositoryGithubId, $this->number);
    }
}
