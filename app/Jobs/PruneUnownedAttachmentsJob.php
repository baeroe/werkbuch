<?php

namespace App\Jobs;

use App\Actions\Attachments\PruneUnownedAttachments;
use App\Models\User;
use App\Support\Actor;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Foundation\Queue\Queueable;

/**
 * Removes uploads nobody owns that are older than 24 hours (spec 4.16, A239), as the default bot. The scheduler puts it
 * on the default queue every hour (routes/console.php).
 */
final class PruneUnownedAttachmentsJob implements ShouldQueue
{
    use Queueable;

    public function handle(): void
    {
        PruneUnownedAttachments::run(Actor::system(User::defaultBot(), 'prune_attachments'), now()->subDay());
    }
}
