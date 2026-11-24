<?php

namespace App\Jobs;

use App\Actions\Agents\CheckThreadMergeability;
use App\Models\User;
use App\Support\Actor;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Foundation\Queue\Queueable;

/**
 * Asks GitHub whether the PR of a strand merges after a push to it or to its base (spec 7.1), with only the ID; GitHub
 * computes it late, so it waits `DELAY` seconds first and comes back while the answer is open.
 */
final class CheckPullRequestMergeability implements ShouldQueue
{
    use Queueable;

    public const DELAY = 10;

    public int $tries = 8;

    /** @var list<int> */
    public array $backoff = [30, 120, 300];

    public function __construct(public readonly string $threadId)
    {
        $this->delay(self::DELAY);
    }

    public function handle(): void
    {
        if (CheckThreadMergeability::run(Actor::system(User::defaultBot(), 'agents'), $this->threadId) === 'pending') {
            $this->release(self::DELAY * 3);
        }
    }
}
