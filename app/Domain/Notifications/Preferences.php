<?php

namespace App\Domain\Notifications;

/**
 * The choices of a person per kind and channel (spec 4.14, table `notification_preferences`). A missing choice is the
 * default: the inbox on, mail as `NotificationKind::mailByDefault()` says.
 */
final class Preferences
{
    /**
     * @param  array<string, bool>  $stored  the stored choices of the person, `"<kind>:<channel>" => enabled`
     */
    public static function enabled(NotificationKind $kind, Channel $channel, array $stored): bool
    {
        return $stored["{$kind->value}:{$channel->value}"] ?? ($channel === Channel::Inbox || $kind->mailByDefault());
    }
}
