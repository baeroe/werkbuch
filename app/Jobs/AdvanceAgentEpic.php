<?php

namespace App\Jobs;

use App\Actions\Agents\AdvanceEpic;
use App\Models\User;
use App\Support\Actor;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Foundation\Queue\Queueable;

/**
 * The next step of an epic on its own branch after a child merged into it (WEBU-71), after the commit, with only the
 * ID of the epic strand; the sweep looks again every minute.
 */
final class AdvanceAgentEpic implements ShouldQueue
{
    use Queueable;

    public int $tries = 3;

    /** @var list<int> */
    public array $backoff = [30, 120];

    public function __construct(public readonly string $threadId) {}

    public function handle(): void
    {
        AdvanceEpic::run(Actor::system(User::defaultBot(), 'agents'), $this->threadId);
    }
}
