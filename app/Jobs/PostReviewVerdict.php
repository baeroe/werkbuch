<?php

namespace App\Jobs;

use App\Actions\Agents\PostReviewVerdict as PostVerdict;
use App\Models\User;
use App\Support\Actor;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Foundation\Queue\Queueable;

/**
 * Writes the verdict of a review at its PR on GitHub after the commit (spec 7.1), with only the ID of the run.
 */
final class PostReviewVerdict implements ShouldQueue
{
    use Queueable;

    public int $tries = 6;

    /** @var list<int> */
    public array $backoff = [30, 120, 300, 900];

    public function __construct(public readonly string $runId) {}

    public function handle(): void
    {
        // a try after the first looks for what an attempt whose answer got lost posted (A602)
        PostVerdict::run(Actor::system(User::defaultBot(), 'agents'), $this->runId, $this->attempts() > 1);
    }
}
