<?php

namespace App\Jobs;

use App\Actions\GitHub\HandleGitHubDelivery;
use App\Models\User;
use App\Support\Actor;
use App\Support\OwnMerges;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Foundation\Queue\Queueable;

/**
 * Works a webhook delivery of GitHub (spec 11.4) on the default queue, with only its ID (the payload stays in its row).
 * A push the guard cannot judge yet (a merge of werkbuch under way) comes back after `PENDING_DELAY` seconds; a sync
 * GitHub did not answer is tried again with the backoff.
 */
final class ProcessGitHubDelivery implements ShouldQueue
{
    use Queueable;

    public const PENDING_DELAY = 60;

    /** Enough rounds of `PENDING_DELAY` to outlast OwnMerges::PENDING_MINUTES. */
    public int $tries = 10;

    /** @var list<int> */
    public array $backoff = [30, 120, 300, 900];

    public function __construct(public readonly string $deliveryId) {}

    public function handle(): void
    {
        $outcome = HandleGitHubDelivery::run(Actor::system(User::defaultBot(), 'github'), $this->deliveryId);

        if ($outcome === OwnMerges::PENDING) {
            $this->release(self::PENDING_DELAY);
        }
    }
}
