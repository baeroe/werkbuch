<?php

namespace App\Actions\Notifications;

use App\Access\Authorize;
use App\Exceptions\Problem;
use App\Models\Notification;
use App\Support\Actor;
use Lorisleiva\Actions\Concerns\AsAction;

/**
 * Deletes a notification from the own inbox (spec 4.14). Only the account's own inbox notification it still sees
 * (NotificationPolicy::delete): a foreign one, one of a project it no longer sees and one only for mail are a 404
 * (K19, A273). No event (A277); the other tabs of the person hear of it.
 */
final class DeleteNotification
{
    use AsAction;

    /**
     * @throws Problem 404
     */
    public function handle(Actor $actor, Notification $notification): void
    {
        Authorize::check($actor, 'delete', $notification);

        MarkNotificationsRead::told($actor, (int) $notification->delete());
    }
}
