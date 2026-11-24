<?php

namespace App\Jobs;

use App\Actions\Agents\MarkThreadReady;
use App\Models\User;
use App\Support\Actor;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Foundation\Queue\Queueable;

/**
 * Marks the draft PR of an epic ready (spec 7.6) after the commit, with only the ID of the strand.
 */
final class MarkPullRequestReady implements ShouldQueue
{
    use Queueable;

    public int $tries = 6;

    /** @var list<int> */
    public array $backoff = [30, 120, 300, 900];

    public function __construct(public readonly string $threadId) {}

    public function handle(): void
    {
        MarkThreadReady::run(Actor::system(User::defaultBot(), 'agents'), $this->threadId);
    }
}
