<?php

namespace App\Live;

use Illuminate\Support\Facades\DB;

/**
 * Tells people that their notifications changed (`notifications.changed` on `presence-user.{id}`): new rows of the
 * inbox (NotifyRecipients, SendDueReminders) or another tab of the person that read, unread or deleted some (the three
 * inbox actions; that tab itself is left out by its socket, A282). Only after the commit of the surrounding transaction,
 * at once without one (DB::afterCommit): a rolled back change tells nobody. Through Broadcasts: a Reverb that is down
 * never fails the caller (K1).
 */
final class NotificationsChanged
{
    /**
     * @param  list<string>  $userIds
     */
    public static function dispatchFor(array $userIds, ?string $socket): void
    {
        if ($userIds === []) {
            return;
        }

        DB::afterCommit(function () use ($userIds, $socket): void {
            foreach ($userIds as $id) {
                Broadcasts::send(LiveMessage::notificationsChanged($id, $socket));
            }
        });
    }
}
