<?php

namespace App\Actions\Notifications;

use App\Access\Authorize;
use App\Domain\Notifications\Channel;
use App\Domain\Notifications\NotificationKind;
use App\Models\Notification;
use App\Models\NotificationPreference;
use App\Support\Actor;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Validator;
use Illuminate\Validation\Rule;
use Illuminate\Validation\ValidationException;
use Lorisleiva\Actions\Concerns\AsAction;

/**
 * Stores choices of the own notification settings (spec 4.14, people only): `preferences` is a list of rows
 * `{event, channel, enabled}` (other keys of a row, such as `user_id` of an answer sent back, are passed over); a row
 * the input names twice takes the last. Rows the input leaves out stay as they are. A setting of a person is no
 * activity, so no event (A277). Answers the whole matrix.
 */
final class SaveNotificationPreferences
{
    use AsAction;

    /** The key the body reads. */
    public const FIELDS = ['preferences'];

    /** The most rows one call takes. */
    public const MAX_ROWS = 100;

    /**
     * @param  array<string, mixed>  $input
     * @return list<array{user_id: string, event: string, channel: string, enabled: bool}>
     *
     * @throws ValidationException
     */
    public function handle(Actor $actor, array $input): array
    {
        Authorize::check($actor, 'managePreferences', Notification::class);

        $valid = Validator::make($input, [
            // more rows than kinds times channels is no setting (T4-M2)
            'preferences' => ['required', 'list', 'max:'.self::MAX_ROWS],
            // a row that is no object is refused as a whole, its fields are not asked for
            'preferences.*' => Rule::forEach(fn (mixed $row) => is_array($row) ? [
                'event' => ['required', Rule::enum(NotificationKind::class)],
                'channel' => ['required', Rule::enum(Channel::class)],
                'enabled' => ['required', 'boolean'],
            ] : ['array']),
        ], [
            'preferences.required' => __('field.required'),
            'preferences.list' => __('field.preferences.invalid'),
            'preferences.max' => __('field.preferences.invalid'),
            'preferences.*.array' => __('field.preferences.invalid'),
            'preferences.*.*.required' => __('field.required'),
            'preferences.*.event.enum' => __('field.preferences.event'),
            'preferences.*.channel.enum' => __('field.preferences.channel'),
            'preferences.*.enabled.boolean' => __('field.boolean'),
        ])->validate();

        // one row per kind and channel, the last choice wins
        $rows = [];
        foreach ($valid['preferences'] as $row) {
            $rows["{$row['event']}:{$row['channel']}"] = [
                'user_id' => $actor->user->id,
                'kind' => $row['event'],
                'channel' => $row['channel'],
                'enabled' => filter_var($row['enabled'], FILTER_VALIDATE_BOOLEAN),
            ];
        }

        // two tabs saving at once may deadlock on the unique index: Laravel tries again (T4-M1)
        DB::transaction(fn () => NotificationPreference::query()->upsert(array_values($rows), ['user_id', 'kind', 'channel'], ['enabled']), 3);

        return GetNotificationPreferences::matrix($actor->user);
    }
}
