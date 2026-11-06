<?php

namespace App\Jobs;

use App\Actions\Webhooks\PruneWebhookDeliveries;
use App\Models\User;
use App\Support\Actor;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Foundation\Queue\Queueable;
use Illuminate\Queue\Middleware\WithoutOverlapping;

/**
 * Tidies up the log of the webhook deliveries (K15), as the default bot. The scheduler puts it on the default queue
 * every hour (routes/console.php); the middleware keeps two from running at once (a second run is dropped).
 */
final class PruneWebhookDeliveriesJob implements ShouldQueue
{
    use Queueable;

    /**
     * @return list<object>
     */
    public function middleware(): array
    {
        return [(new WithoutOverlapping('prune-webhook-deliveries'))->dontRelease()->expireAfter(3600)];
    }

    public function handle(): void
    {
        PruneWebhookDeliveries::run(Actor::system(User::defaultBot(), 'prune_webhooks'));
    }
}
