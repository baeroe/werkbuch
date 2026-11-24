<?php

namespace App\Jobs;

use App\Actions\Agents\GiveUpOnThread;
use App\Actions\Agents\MergeThread;
use App\Models\User;
use App\Support\Actor;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Foundation\Queue\Queueable;
use Illuminate\Queue\Middleware\WithoutOverlapping;

/**
 * Merges the PR of a strand at the head commit werkbuch decided on (spec 7.2, ApproveAndMerge), with only the IDs. While
 * GitHub still computes whether the PR merges it comes back after `PENDING_DELAY` seconds; GitHub without an answer is
 * tried again with the backoff; after the last attempt werkbuch gives up on that head (GiveUpOnThread). One merge of a
 * strand at a time.
 */
final class MergeAgentPullRequest implements ShouldQueue
{
    use Queueable;

    public const PENDING_DELAY = 15;

    public int $tries = 10;

    /** @var list<int> */
    public array $backoff = [30, 120, 300, 900];

    public function __construct(public readonly string $threadId, public readonly string $sha) {}

    /** @return list<object> */
    public function middleware(): array
    {
        // a worker that died holding the lock frees it after ten minutes
        return [(new WithoutOverlapping("agent-merge:{$this->threadId}"))->releaseAfter(30)->expireAfter(600)];
    }

    /** Every attempt failed: the decision goes, the agent says so and the item goes to „Korrektur“ (A601). */
    public function failed(): void
    {
        GiveUpOnThread::run(Actor::system(User::defaultBot(), 'agents'), $this->threadId, 'merge', $this->sha);
    }

    public function handle(): void
    {
        if (MergeThread::run(Actor::system(User::defaultBot(), 'agents'), $this->threadId, $this->sha) === 'pending') {
            $this->release(self::PENDING_DELAY);
        }
    }
}
