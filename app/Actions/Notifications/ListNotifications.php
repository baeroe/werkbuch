<?php

namespace App\Actions\Notifications;

use App\Domain\Notifications\NotificationKind;
use App\Models\Notification;
use App\Support\Actor;
use App\Support\ListFilter;
use App\Support\ListQuery;
use App\Support\ListResult;
use App\Support\ListSpec;
use App\Support\PageArgs;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Validation\ValidationException;
use Lorisleiva\Actions\Concerns\AsAction;

/**
 * The inbox of the account (spec 4.14): its own notifications shown in the inbox (`inbox`, A271), only those it still
 * sees (Notification::visibleTo, K5: checked when read, never when written, Review Focus 3), newest first (`created_at`
 * to the microsecond, then the ULID, so a page never loses one of the same second). `filter[unread]` keeps the unread or
 * the read ones, `filter[event]` the kinds named. A bot has an empty inbox: no notification is ever written for a bot
 * (NotifyRecipients and SendDueReminders take persons only). Each notification comes with its lean item and its excerpt
 * for the reader (Notification::loadForResource).
 */
final class ListNotifications
{
    use AsAction;

    /** The rules of the list (A386, K11): `unread`, and the event (its kind) as the resource and the settings name it. */
    public static function spec(): ListSpec
    {
        return new ListSpec(
            filters: [
                ListFilter::scope('unread', 'boolean', fn (Builder $query, mixed $unread) => $unread
                    ? $query->whereNull('notifications.read_at') : $query->whereNotNull('notifications.read_at')),
                ListFilter::exact('event', 'notifications.kind', array_column(NotificationKind::cases(), 'value')),
            ],
            // the stamp as the database has it, with its microseconds, as the alias `created_cursor`
            sorts: ['created_at' => 'created_cursor'],
            default: ['-created_at'],
            // a fixed order: newest first, of equal stamps the higher (newer) ULID first
            sortable: false,
            tiebreak: 'desc',
        );
    }

    /**
     * @param  array<array-key, mixed>  $query  `filter[unread]`, `filter[event]`, `sort`, `cursor`, `per_page`
     * @return ListResult<Notification>
     *
     * @throws ValidationException
     */
    public function handle(Actor $actor, array $query): ListResult
    {
        $notifications = Notification::query()
            // the stamp as the database has it for the cursor: the cast would lose the microseconds (Carbon as text)
            ->select('notifications.*')->addSelect('notifications.created_at as created_cursor')
            ->inboxOf($actor->user);
        [$notifications, $signature] = ListQuery::apply($notifications, $query, self::spec());

        $result = ListResult::of($notifications, PageArgs::from($query), $signature);
        Notification::loadForResource((new Notification)->newCollection($result->page->items()), $actor->user);

        return $result;
    }
}
