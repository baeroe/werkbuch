<?php

namespace App\Jobs;

use App\Actions\Notifications\PruneNotifications;
use App\Models\User;
use App\Support\Actor;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Foundation\Queue\Queueable;
use Illuminate\Queue\Middleware\WithoutOverlapping;

/**
 * Tidies up notifications and mail collections (A276), as the default bot. The scheduler puts it on the default queue
 * every hour (routes/console.php); `withoutOverlapping` there only keeps it from being queued twice, the middleware
 * keeps two from running at once (a second run is dropped, the next hour comes).
 */
final class PruneNotificationsJob implements ShouldQueue
{
    use Queueable;

    /**
     * @return list<object>
     */
    public function middleware(): array
    {
        return [(new WithoutOverlapping('prune-notifications'))->dontRelease()->expireAfter(3600)];
    }

    public function handle(): void
    {
        PruneNotifications::run(Actor::system(User::defaultBot(), 'prune_notifications'));
    }
}
