<?php

namespace App\Actions\Notifications;

use App\Domain\Notifications\NotificationKind;
use App\Models\Notification;
use App\Support\Actor;
use App\Support\ListResult;
use App\Support\PageArgs;
use Illuminate\Support\Facades\Validator;
use Illuminate\Validation\ValidationException;
use Lorisleiva\Actions\Concerns\AsAction;

/**
 * The inbox of the account (spec 4.14): its own notifications shown in the inbox (`inbox`, A271), only those it still
 * sees (Notification::visibleTo, K5: checked when read, never when written, Review Focus 3), newest first (`created_at`
 * to the microsecond, then the ULID, so a page never loses one of the same second). `unread_only` keeps the unread,
 * `mentions_only` the mentions. A bot gets none, its inbox is empty. Each notification comes with its lean item and its
 * excerpt for the reader (Notification::loadForResource).
 */
final class ListNotifications
{
    use AsAction;

    /**
     * @param  array<array-key, mixed>  $query  `unread_only`, `mentions_only` (true or false), `cursor`, `per_page`
     * @return ListResult<Notification>
     *
     * @throws ValidationException at `unread_only`, `mentions_only`, `cursor` or `per_page`
     */
    public function handle(Actor $actor, array $query): ListResult
    {
        $valid = Validator::make($query, [
            'unread_only' => ['nullable', 'boolean'],
            'mentions_only' => ['nullable', 'boolean'],
        ], [
            'unread_only.boolean' => __('field.boolean'),
            'mentions_only.boolean' => __('field.boolean'),
        ])->validate();
        $args = PageArgs::from($query);

        $notifications = Notification::query()
            // the stamp as the database has it for the cursor: the cast would lose the microseconds (Carbon as text)
            ->select('notifications.*')->addSelect('notifications.created_at as created_cursor')
            ->inboxOf($actor->user)
            ->when((bool) ($valid['unread_only'] ?? false), fn ($unread) => $unread->whereNull('read_at'))
            ->when((bool) ($valid['mentions_only'] ?? false), fn ($mentions) => $mentions->where('kind', NotificationKind::Mentioned))
            ->orderByDesc('created_cursor')->orderByDesc('id');

        $result = ListResult::of($notifications, $args);
        Notification::loadForResource((new Notification)->newCollection($result->page->items()), $actor->user);

        return $result;
    }
}
