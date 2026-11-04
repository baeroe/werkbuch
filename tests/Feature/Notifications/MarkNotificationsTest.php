<?php

use App\Access\ProjectRole;
use App\Actions\Notifications\MarkNotificationsRead;
use App\Actions\Notifications\MarkNotificationsUnread;
use App\Domain\Notifications\NotificationKind;
use App\Models\Event;
use App\Models\Notification;
use App\Models\Project;
use App\Models\User;
use App\Models\WorkItem;
use Illuminate\Support\Carbon;
use Illuminate\Support\Str;
use Illuminate\Validation\ValidationException;

/*
 * Marking read and unread (Task 6): only the own inbox notifications the person still sees (K5, A273); anything else in
 * `ids` is passed over without a word. No event (A277). Mara is a member of the public WEB; OPS is private without her.
 */

$world = function (): array {
    $tom = User::factory()->create();
    $web = Project::factory()->public()->member($tom, ProjectRole::Admin)->create();
    $ops = Project::factory()->private()->member($tom, ProjectRole::Admin)->create();
    $mara = memberOf($web, ProjectRole::Member);
    $ida = memberOf($web, ProjectRole::Member);

    return ['mara' => $mara, 'ida' => $ida, 'item' => WorkItem::factory()->for($web)->create(), 'secret' => WorkItem::factory()->for($ops)->create()];
};

/** Whether each notification is read now, by id. */
$read = fn (Notification ...$notifications) => array_map(fn (Notification $n) => $n->fresh()?->read_at !== null, $notifications);

it('marks my own as read and skips foreign ids', function () use ($world, $read) {
    $w = $world();
    $mine = fn () => Notification::factory()->forItem($w['item'])->create(['user_id' => $w['mara']->id]);
    [$one, $two] = [$mine(), $mine()];
    $earlier = Carbon::parse('2026-11-01 08:00:00.123456', 'UTC');
    $already = Notification::factory()->forItem($w['item'])->create(['user_id' => $w['mara']->id, 'read_at' => $earlier]);
    $foreign = Notification::factory()->forItem($w['item'])->create(['user_id' => $w['ida']->id]);
    // an own row of a project Mara does not see, and one only for mail (A273)
    $hidden = Notification::factory()->forItem($w['secret'])->create(['user_id' => $w['mara']->id]);
    $mailOnly = Notification::factory()->forItem($w['item'])->mailOnly()->create(['user_id' => $w['mara']->id]);
    $before = Event::query()->count();

    $updated = MarkNotificationsRead::run(actor($w['mara']), ['ids' => [
        strtoupper($one->id), $two->id, $two->id, $already->id, $foreign->id, $hidden->id, $mailOnly->id, Str::lower((string) Str::ulid()),
    ]]);

    expect($updated)->toBe(2)
        ->and($read($one, $two, $foreign, $hidden, $mailOnly))->toBe([true, true, false, false, false])
        // an already read one keeps its moment
        ->and($already->fresh()->read_at->format('Y-m-d H:i:s.u'))->toBe('2026-11-01 08:00:00.123456')
        ->and(Event::query()->count())->toBe($before);
});

it('marks all, or all mentions, as read (A291)', function () use ($world, $read) {
    $w = $world();
    $make = fn (NotificationKind $kind, string $user = 'mara', string $item = 'item') => Notification::factory()->forItem($w[$item])
        ->kind($kind, $kind === NotificationKind::Mentioned ? ['source' => 'values'] : [])->create(['user_id' => $w[$user]->id]);
    $mention = $make(NotificationKind::Mentioned);
    $change = $make(NotificationKind::ItemChanged);
    $comment = $make(NotificationKind::Comment);
    $foreign = $make(NotificationKind::Mentioned, 'ida');
    $hidden = $make(NotificationKind::Mentioned, 'mara', 'secret');
    $mailOnly = Notification::factory()->forItem($w['item'])->kind(NotificationKind::Mentioned, ['source' => 'values'])->mailOnly()->create(['user_id' => $w['mara']->id]);

    expect(MarkNotificationsRead::run(actor($w['mara']), ['all' => true, 'mentions_only' => true]))->toBe(1)
        ->and($read($mention, $change, $comment, $foreign, $hidden, $mailOnly))->toBe([true, false, false, false, false, false])
        ->and(MarkNotificationsRead::run(actor($w['mara']), ['all' => '1', 'mentions_only' => false]))->toBe(2)
        ->and($read($mention, $change, $comment, $foreign, $hidden, $mailOnly))->toBe([true, true, true, false, false, false])
        ->and(MarkNotificationsRead::run(actor($w['mara']), ['all' => true]))->toBe(0);
});

it('marks unread again', function () use ($world, $read) {
    $w = $world();
    $readOne = fn (string $user = 'mara', string $item = 'item') => Notification::factory()->forItem($w[$item])->read()->create(['user_id' => $w[$user]->id]);
    $mine = $readOne();
    $unread = Notification::factory()->forItem($w['item'])->create(['user_id' => $w['mara']->id]);
    $foreign = $readOne('ida');
    $hidden = $readOne('mara', 'secret');
    $mailOnly = Notification::factory()->forItem($w['item'])->read()->mailOnly()->create(['user_id' => $w['mara']->id]);
    $before = Event::query()->count();

    expect(MarkNotificationsUnread::run(actor($w['mara']), ['ids' => [$mine->id, $unread->id, $foreign->id, $hidden->id, $mailOnly->id]]))->toBe(1)
        ->and($read($mine, $unread, $foreign, $hidden, $mailOnly))->toBe([false, false, true, true, true])
        ->and(Event::query()->count())->toBe($before);
});

it('refuses more than 100 ids', function () use ($world) {
    $w = $world();
    $errors = function (string $action, array $input) use ($w): array {
        try {
            $action::run(actor($w['mara']), $input);
        } catch (ValidationException $invalid) {
            return $invalid->errors();
        }
        throw new RuntimeException('expected a 422');
    };
    $ids = __('field.ids.notifications', ['max' => 100]);
    $ulids = fn (int $n) => array_map(fn () => Str::lower((string) Str::ulid()), range(1, $n));

    foreach ([MarkNotificationsRead::class, MarkNotificationsUnread::class] as $action) {
        foreach ([[], ['ids' => $ulids(101)], ['ids' => []], ['ids' => 'abc'], ['ids' => ['nope']], ['ids' => [1]], ['ids' => ['a' => $ulids(1)[0]]]] as $input) {
            expect($errors($action, $input))->toBe(['ids' => [$ids]]);
        }
    }
    // a hundred go
    expect(MarkNotificationsRead::run(actor($w['mara']), ['ids' => $ulids(100)]))->toBe(0)
        ->and(MarkNotificationsUnread::run(actor($w['mara']), ['ids' => $ulids(100)]))->toBe(0)
        // ids or all, never both; all and mentions_only only true or false
        ->and($errors(MarkNotificationsRead::class, ['all' => true, 'ids' => $ulids(1)]))->toBe(['all' => [__('field.notifications.ids_or_all')]])
        // mentions_only belongs to all: next to ids it would be passed over in silence (T6-M3)
        ->and($errors(MarkNotificationsRead::class, ['ids' => $ulids(1), 'mentions_only' => true]))->toBe(['mentions_only' => [__('field.notifications.mentions_only_with_all')]])
        ->and($errors(MarkNotificationsRead::class, ['all' => 'yes', 'mentions_only' => 'no']))->toBe([
            'all' => [__('field.boolean')],
            'mentions_only' => [__('field.boolean')],
        ])
        // all: false is no all
        ->and($errors(MarkNotificationsRead::class, ['all' => false]))->toBe(['ids' => [$ids]]);
});
