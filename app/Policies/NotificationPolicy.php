<?php

namespace App\Policies;

use App\Models\Notification;
use App\Models\User;
use Illuminate\Auth\Access\Response;

/**
 * Who may do what with notifications (spec 4.14). A notification is its person's alone, only in the inbox (a row only
 * for mail is none there, A271, A273) and only while they still see what it is about (Notification::visibleTo, K5,
 * K19): anything else is a 404, never a 403, so a foreign or hidden row gives nothing away. Notification preferences
 * are for people; a bot gets no notifications.
 */
final class NotificationPolicy
{
    public function view(User $user, Notification $notification): Response
    {
        return self::own($user, $notification);
    }

    /** Marking it read or unread. */
    public function update(User $user, Notification $notification): Response
    {
        return self::own($user, $notification);
    }

    public function delete(User $user, Notification $notification): Response
    {
        return self::own($user, $notification);
    }

    public function managePreferences(User $user): Response
    {
        return $user->isPerson() ? Response::allow() : Response::deny(__('problem.detail.persons_only_notifications'));
    }

    private static function own(User $user, Notification $notification): Response
    {
        $visible = $notification->user_id === $user->id
            && Notification::query()->visibleTo($user)->where('inbox', true)->whereKey($notification->getKey())->exists();

        return $visible ? Response::allow() : Response::denyAsNotFound();
    }
}
