<?php

namespace App\Actions\Notifications;

use App\Support\Actor;
use Illuminate\Validation\ValidationException;
use Lorisleiva\Actions\Concerns\AsAction;

/**
 * Marks notifications of the own inbox unread again (spec 4.14): the read ones named in `ids` (1–100 ULIDs) among the
 * account's own inbox notifications it still sees (MarkNotificationsRead::inbox(), K5, A273); any other ID is passed
 * over without a word. No event (A277).
 */
final class MarkNotificationsUnread
{
    use AsAction;

    /**
     * @param  array<array-key, mixed>  $input  `ids`
     * @return int the number of notifications marked unread
     *
     * @throws ValidationException at `ids`
     */
    public function handle(Actor $actor, array $input): int
    {
        return MarkNotificationsRead::inbox($actor->user)->whereNotNull('read_at')
            ->whereKey(MarkNotificationsRead::ids($input))->update(['read_at' => null]);
    }
}
