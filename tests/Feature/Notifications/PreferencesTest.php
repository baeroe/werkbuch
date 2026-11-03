<?php

use App\Actions\Notifications\GetNotificationPreferences;
use App\Actions\Notifications\SaveNotificationPreferences;
use App\Exceptions\Problem;
use App\Models\Event;
use App\Models\NotificationPreference;
use App\Models\User;
use Illuminate\Validation\ValidationException;

/** The rows of the matrix as `"<event>:<channel>" => enabled`, in the order the action answers them. */
$flat = fn (array $rows): array => collect($rows)->mapWithKeys(fn (array $row) => ["{$row['event']}:{$row['channel']}" => $row['enabled']])->all();

it('answers the defaults of the spec for a new person', function () use ($flat) {
    $mara = User::factory()->create();

    $rows = GetNotificationPreferences::run(actor($mara));

    expect($rows)->toHaveCount(18)
        ->and(collect($rows)->pluck('user_id')->unique()->all())->toBe([$mara->id])
        ->and($flat($rows))->toBe([
            'assigned:inbox' => true, 'assigned:mail' => true,
            'mentioned:inbox' => true, 'mentioned:mail' => true,
            'comment:inbox' => true, 'comment:mail' => true,
            'state_changed:inbox' => true, 'state_changed:mail' => false,
            'item_changed:inbox' => true, 'item_changed:mail' => false,
            'due:inbox' => true, 'due:mail' => true,
            'item_created:inbox' => true, 'item_created:mail' => false,
            'template_run_failed:inbox' => true, 'template_run_failed:mail' => false,
            'webhook_disabled:inbox' => true, 'webhook_disabled:mail' => false,
        ])
        ->and(array_keys($rows[0]))->toBe(['user_id', 'event', 'channel', 'enabled']);
});

it('stores a choice and answers the whole matrix', function () use ($flat) {
    $mara = User::factory()->create();
    $erik = User::factory()->create();
    SaveNotificationPreferences::run(actor($erik), ['preferences' => [['event' => 'comment', 'channel' => 'mail', 'enabled' => false]]]);

    $rows = SaveNotificationPreferences::run(actor($mara), ['preferences' => [
        ['event' => 'comment', 'channel' => 'mail', 'enabled' => false],
        ['event' => 'state_changed', 'channel' => 'mail', 'enabled' => true],
        // a row of the answer comes back as it was sent: `user_id` is passed over
        ['user_id' => $erik->id, 'event' => 'due', 'channel' => 'inbox', 'enabled' => false],
    ]]);

    expect($rows)->toHaveCount(18)
        ->and($flat($rows))->toMatchArray(['comment:mail' => false, 'state_changed:mail' => true, 'due:inbox' => false, 'comment:inbox' => true])
        ->and($flat(GetNotificationPreferences::run(actor($mara))))->toBe($flat($rows))
        ->and($flat(GetNotificationPreferences::run(actor($erik))))->toMatchArray(['comment:mail' => false, 'state_changed:mail' => false, 'due:inbox' => true]);

    // a second choice of the same row changes it, it adds none
    SaveNotificationPreferences::run(actor($mara), ['preferences' => [['event' => 'comment', 'channel' => 'mail', 'enabled' => true]]]);

    expect(NotificationPreference::query()->where('user_id', $mara->id)->count())->toBe(3)
        ->and($flat(GetNotificationPreferences::run(actor($mara))))->toMatchArray(['comment:mail' => true, 'state_changed:mail' => true]);
});

it('takes the last of two choices of the same row', function () use ($flat) {
    $mara = User::factory()->create();

    $rows = SaveNotificationPreferences::run(actor($mara), ['preferences' => [
        ['event' => 'due', 'channel' => 'mail', 'enabled' => false],
        ['event' => 'due', 'channel' => 'mail', 'enabled' => true],
        ['event' => 'item_changed', 'channel' => 'mail', 'enabled' => true],
        ['event' => 'item_changed', 'channel' => 'mail', 'enabled' => false],
    ]]);

    expect($flat($rows))->toMatchArray(['due:mail' => true, 'item_changed:mail' => false])
        ->and(NotificationPreference::query()->where('user_id', $mara->id)->count())->toBe(2);
});

it('refuses an unknown event and channel at their row', function () {
    $mara = User::factory()->create();

    try {
        SaveNotificationPreferences::run(actor($mara), ['preferences' => [
            ['event' => 'comment', 'channel' => 'mail', 'enabled' => false],
            ['event' => 'reaction', 'channel' => 'inbox', 'enabled' => true],
            ['event' => 'comment', 'channel' => 'push', 'enabled' => true],
            ['event' => 'comment', 'channel' => 'inbox', 'enabled' => 'maybe'],
            ['event' => 'comment', 'channel' => 'inbox'],
            'comment',
        ]]);
        $this->fail('The preferences were taken.');
    } catch (ValidationException $e) {
        // every refused row at once, at its place (in any order)
        expect($e->errors())->toEqual([
            'preferences.1.event' => [__('field.preferences.event')],
            'preferences.2.channel' => [__('field.preferences.channel')],
            'preferences.3.enabled' => [__('field.boolean')],
            'preferences.4.enabled' => [__('field.required')],
            'preferences.5' => [__('field.preferences.invalid')],
        ]);
    }

    // nothing of a refused input is stored, also not its valid rows
    expect(NotificationPreference::query()->count())->toBe(0);
});

it('refuses preferences that are no list', function (mixed $preferences, string $message) {
    $mara = User::factory()->create();

    expect(fn () => SaveNotificationPreferences::run(actor($mara), $preferences === 'missing' ? [] : ['preferences' => $preferences]))
        ->toThrow(fn (ValidationException $e) => expect($e->errors())->toBe(['preferences' => [__($message)]]));
})->with([
    'missing' => ['missing', 'field.required'],
    'a text' => ['all', 'field.preferences.invalid'],
    'an object' => [['comment' => ['event' => 'comment', 'channel' => 'mail', 'enabled' => false]], 'field.preferences.invalid'],
]);

it('refuses a bot with 403', function () {
    $bot = User::factory()->bot()->create();

    expect(fn () => SaveNotificationPreferences::run(actor($bot), ['preferences' => [['event' => 'comment', 'channel' => 'mail', 'enabled' => false]]]))
        ->toThrow(fn (Problem $p) => expect($p->getStatusCode())->toBe(403)->and($p->detail)->toBe(__('problem.detail.persons_only_notifications')))
        // a bot gets no notifications, so it has no matrix to read either
        ->and(GetNotificationPreferences::run(actor($bot)))->toBe([])
        ->and(GetNotificationPreferences::run(actor(User::defaultBot())))->toBe([])
        ->and(NotificationPreference::query()->count())->toBe(0);
});

it('writes no event', function () {
    $mara = User::factory()->create();
    $before = Event::query()->count();

    SaveNotificationPreferences::run(actor($mara), ['preferences' => [['event' => 'comment', 'channel' => 'mail', 'enabled' => false]]]);
    SaveNotificationPreferences::run(actor($mara), ['preferences' => [['event' => 'comment', 'channel' => 'mail', 'enabled' => true]]]);

    expect(Event::query()->count())->toBe($before);
});
