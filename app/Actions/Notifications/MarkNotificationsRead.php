<?php

namespace App\Actions\Notifications;

use App\Domain\Notifications\NotificationKind;
use App\Live\NotificationsChanged;
use App\Models\Notification;
use App\Models\User;
use App\Support\Actor;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Support\Facades\Validator;
use Illuminate\Support\Str;
use Illuminate\Validation\ValidationException;
use Lorisleiva\Actions\Concerns\AsAction;

/**
 * Marks notifications of the own inbox read (spec 4.14): the ones named in `ids`, or with `all: true` every unread one,
 * with `mentions_only` every unread mention (A291: what the filter of the inbox shows, never what it hides). Only the
 * account's own inbox notifications it still sees count (inbox(), K5, A273); any other ID, foreign, hidden, only for
 * mail or unknown, is passed over without a word, so the answer tells nothing about it. An already read one keeps its
 * moment. No event: reading is a setting of one person (A277); the other tabs of the person hear of a change.
 */
final class MarkNotificationsRead
{
    use AsAction;

    /** The most notifications one call names. */
    public const MAX_IDS = 100;

    /**
     * @param  array<array-key, mixed>  $input  `ids` (1–100 ULIDs) or `all: true` with `mentions_only`
     * @return int the number of notifications marked read
     *
     * @throws ValidationException at `ids`, `all` or `mentions_only`
     */
    public function handle(Actor $actor, array $input): int
    {
        $valid = Validator::make($input, [
            'all' => ['nullable', 'boolean'],
            'mentions_only' => ['nullable', 'boolean'],
        ], [
            'all.boolean' => __('field.boolean'),
            'mentions_only.boolean' => __('field.boolean'),
        ])->validate();

        $unread = self::inbox($actor->user)->whereNull('read_at');
        if ((bool) ($valid['all'] ?? false)) {
            if (($input['ids'] ?? null) !== null) {
                throw ValidationException::withMessages(['all' => __('field.notifications.ids_or_all')]);
            }
            $unread->when((bool) ($valid['mentions_only'] ?? false), fn ($mentions) => $mentions->where('kind', NotificationKind::Mentioned));
        } else {
            $unread->whereKey(self::ids($input));
        }

        return self::told($actor, $unread->update(['read_at' => (new Notification)->fromDateTime(now())]));
    }

    /**
     * Tells the other tabs of the person that their inbox changed, when it did (the own tab is left out by its socket,
     * A282); shared by the inbox actions.
     *
     * @return int the number it was given
     */
    public static function told(Actor $actor, int $changed): int
    {
        if ($changed > 0) {
            NotificationsChanged::dispatchFor([$actor->user->id], $actor->socket);
        }

        return $changed;
    }

    /**
     * The inbox notifications of the account that it still sees: what every inbox action may touch (K5, A273).
     *
     * @return Builder<Notification>
     */
    public static function inbox(User $user): Builder
    {
        return Notification::query()->where('user_id', $user->id)->where('inbox', true)->visibleTo($user);
    }

    /**
     * `ids` as a list of 1 to 100 ULIDs, in any case, without repeats, lowercase.
     *
     * @param  array<array-key, mixed>  $input
     * @return list<string>
     *
     * @throws ValidationException at `ids`
     */
    public static function ids(array $input): array
    {
        $ids = $input['ids'] ?? null;
        $valid = is_array($ids) && array_is_list($ids) && $ids !== [] && count($ids) <= self::MAX_IDS
            && array_all($ids, fn (mixed $id) => is_string($id) && Str::isUlid($id));
        if (! $valid) {
            throw ValidationException::withMessages(['ids' => __('field.ids.notifications', ['max' => self::MAX_IDS])]);
        }

        /** @var list<string> $ids */
        return array_values(array_unique(array_map(strtolower(...), $ids)));
    }
}
