<?php

namespace App\Jobs;

use App\Actions\Attachments\PruneUnownedAttachments;
use App\Models\User;
use App\Support\Actor;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Foundation\Queue\Queueable;
use Illuminate\Queue\Middleware\WithoutOverlapping;

/**
 * Removes uploads nobody owns that are older than 24 hours (spec 4.16, A239), as the default bot. The scheduler puts it
 * on the default queue every hour (routes/console.php); `withoutOverlapping` there only keeps it from being queued
 * twice, the middleware keeps two from running at once (a second run is dropped, the next hour comes, T13-M7).
 */
final class PruneUnownedAttachmentsJob implements ShouldQueue
{
    use Queueable;

    /**
     * @return list<object>
     */
    public function middleware(): array
    {
        return [(new WithoutOverlapping('prune-unowned-attachments'))->dontRelease()->expireAfter(3600)];
    }

    public function handle(): void
    {
        PruneUnownedAttachments::run(Actor::system(User::defaultBot(), 'prune_attachments'), now()->subDay());
    }
}
