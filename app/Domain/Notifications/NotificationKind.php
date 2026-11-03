<?php

namespace App\Domain\Notifications;

/**
 * What a notification tells (spec 4.14): the kinds of the table "Benachrichtigungsarten" of the phase plan 8, named
 * like `NOTIFICATION_EVENTS` of the clickdummy. `template_run_failed` and `webhook_disabled` come with phases 10 and 11
 * (A290); until then they only have their preferences.
 */
enum NotificationKind: string
{
    case Assigned = 'assigned';
    case Mentioned = 'mentioned';
    case Comment = 'comment';
    case StateChanged = 'state_changed';
    case ItemChanged = 'item_changed';
    case Due = 'due';
    case ItemCreated = 'item_created';
    case TemplateRunFailed = 'template_run_failed';
    case WebhookDisabled = 'webhook_disabled';

    /** The order of the clickdummy: how the preferences list the kinds. */
    public const ORDER = [
        self::Assigned, self::Mentioned, self::Comment, self::StateChanged, self::ItemChanged, self::Due,
        self::ItemCreated, self::TemplateRunFailed, self::WebhookDisabled,
    ];

    /** How strong the kind is when several meet one person (A267): the smaller, the stronger. */
    public function rank(): int
    {
        return match ($this) {
            self::Mentioned => 1,
            self::Assigned => 2,
            self::Comment => 3,
            self::StateChanged => 4,
            self::ItemChanged => 5,
            self::Due => 6,
            self::ItemCreated => 7,
            self::TemplateRunFailed => 8,
            self::WebhookDisabled => 9,
        };
    }

    /** Whether a person gets a mail of the kind before they chose (spec 4.14); the inbox is always on by default. */
    public function mailByDefault(): bool
    {
        return in_array($this, [self::Mentioned, self::Assigned, self::Comment, self::Due], true);
    }
}
