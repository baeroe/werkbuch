<?php

namespace App\Jobs;

use App\Actions\GitHub\PruneGitHubDeliveries;
use App\Models\User;
use App\Support\Actor;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Foundation\Queue\Queueable;
use Illuminate\Queue\Middleware\WithoutOverlapping;

/**
 * Forgets old webhook deliveries of GitHub (WEBU-24), as the default bot, every hour (routes/console.php); the
 * middleware keeps two from running at once.
 */
final class PruneGitHubDeliveriesJob implements ShouldQueue
{
    use Queueable;

    /**
     * @return list<object>
     */
    public function middleware(): array
    {
        return [(new WithoutOverlapping('prune-github-deliveries'))->dontRelease()->expireAfter(3600)];
    }

    public function handle(): void
    {
        PruneGitHubDeliveries::run(Actor::system(User::defaultBot(), 'prune_github'));
    }
}
