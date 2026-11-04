<?php

namespace App\Actions\Notifications;

use App\Domain\Notifications\Channel;
use App\Domain\Notifications\NotificationKind;
use App\Domain\Notifications\Preferences;
use App\Models\NotificationPreference;
use App\Models\User;
use App\Support\Actor;
use Lorisleiva\Actions\Concerns\AsAction;

/**
 * The notification settings of the own account (spec 4.14): every kind (`NotificationKind::ORDER`) once for the inbox
 * and once for mail, each the stored choice or the default. A bot gets no notifications and reads an empty matrix (K6).
 */
final class GetNotificationPreferences
{
    use AsAction;

    /**
     * @return list<array{user_id: string, event: string, channel: string, enabled: bool}>
     */
    public function handle(Actor $actor): array
    {
        return self::matrix($actor->user);
    }

    /**
     * @return list<array{user_id: string, event: string, channel: string, enabled: bool}>
     */
    public static function matrix(User $user): array
    {
        if (! $user->isPerson()) {
            return [];
        }

        $stored = $user->notificationPreferences()->get()
            ->mapWithKeys(fn (NotificationPreference $row) => ["{$row->kind->value}:{$row->channel->value}" => $row->enabled])
            ->all();

        $rows = [];
        foreach (NotificationKind::ORDER as $kind) {
            foreach ([Channel::Inbox, Channel::Mail] as $channel) {
                $rows[] = [
                    'user_id' => $user->id,
                    'event' => $kind->value,
                    'channel' => $channel->value,
                    'enabled' => Preferences::enabled($kind, $channel, $stored),
                ];
            }
        }

        return $rows;
    }
}
