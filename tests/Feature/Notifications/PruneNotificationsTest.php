<?php

use App\Actions\Notifications\PruneNotifications;
use App\Jobs\PruneNotificationsJob;
use App\Models\Notification;
use App\Models\NotificationMail;
use App\Models\User;
use App\Models\WorkItem;
use App\Support\Actor;
use Illuminate\Console\Scheduling\Schedule;
use Illuminate\Queue\Middleware\WithoutOverlapping;
use Illuminate\Support\Str;

/*
 * Tidying up (Task 8, A276): every hour the read notifications older than 90 days go, the rows only for mail two days after their
 * collection is sent (or skipped, K8), and the sent collections older than 90 days. Mara's notifications about one item.
 */

$world = function (): array {
    $mara = User::factory()->create(['name' => 'Mara']);

    return ['mara' => $mara, 'item' => WorkItem::factory()->create(['created_by' => $mara->id])];
};

/** A notification of Mara about the item. */
$line = fn (array $w, array $attributes = []) => Notification::factory()->forItem($w['item'])->create(['user_id' => $w['mara']->id, ...$attributes]);

$prune = fn () => PruneNotifications::run(Actor::system(User::defaultBot(), 'prune_notifications'));

it('deletes read notifications after 90 days, keeps unread ones', function () use ($world, $line, $prune) {
    $w = $world();
    $old = $line($w, ['read_at' => now()->subDays(91)]);
    $recent = $line($w, ['read_at' => now()->subDays(89)]);
    $unread = $line($w, ['created_at' => now()->subDays(200)]);

    expect($prune())->toBe(1)
        ->and(Notification::query()->orderBy('id')->pluck('id')->all())->toBe(collect([$recent->id, $unread->id])->sort()->values()->all())
        ->and(Notification::query()->find($old->id))->toBeNull();
});

it('deletes sent mail-only rows and old collections', function () use ($world, $line, $prune) {
    $w = $world();
    $sent = NotificationMail::factory()->sent(now()->subDays(3))->create(['user_id' => $w['mara']->id]);
    $skipped = NotificationMail::factory()->skipped()->create(['user_id' => $w['mara']->id, 'sent_at' => now()->subDays(3)]);
    $justSent = NotificationMail::factory()->sent(now()->subDays(2)->addMinute())->create(['user_id' => $w['mara']->id]);
    $open = NotificationMail::factory()->create(['user_id' => $w['mara']->id, 'due_at' => now()->subDays(100)]);
    $old = NotificationMail::factory()->sent(now()->subDays(91))->create(['user_id' => $w['mara']->id]);
    $young = NotificationMail::factory()->sent(now()->subDays(89))->create(['user_id' => $w['mara']->id]);

    $mailOnlySent = $line($w, ['inbox' => false, 'mail_id' => $sent->id]);
    $mailOnlySkipped = $line($w, ['inbox' => false, 'mail_id' => $skipped->id]);
    $mailOnlyOpen = $line($w, ['inbox' => false, 'mail_id' => $open->id]);
    // two days after its mail at the earliest (the day of a reminder in every zone, and a job that runs again, T8-M1)
    $mailOnlyJustSent = $line($w, ['inbox' => false, 'mail_id' => $justSent->id]);
    $inboxOfOld = $line($w, ['mail_id' => $old->id]);
    $inboxOfSent = $line($w, ['mail_id' => $sent->id]);

    // two mail-only rows and one collection
    expect($prune())->toBe(3)
        ->and(Notification::query()->pluck('id')->sort()->values()->all())
        ->toBe(collect([$mailOnlyOpen->id, $mailOnlyJustSent->id, $inboxOfOld->id, $inboxOfSent->id])->sort()->values()->all())
        ->and(NotificationMail::query()->pluck('id')->sort()->values()->all())
        ->toBe(collect([$sent->id, $skipped->id, $justSent->id, $open->id, $young->id])->sort()->values()->all())
        // an inbox row of a pruned collection stays, without its mail
        ->and($inboxOfOld->fresh()->mail_id)->toBeNull()
        ->and($mailOnlySent->fresh())->toBeNull()
        ->and($mailOnlySkipped->fresh())->toBeNull();
});

it('works through more rows than fit into one block', function () use ($world, $prune) {
    $w = $world();
    $read = now()->subDays(100)->format('Y-m-d H:i:s.u');
    Notification::query()->insert(array_map(fn (int $n) => [
        'id' => Str::lower((string) Str::ulid()), 'user_id' => $w['mara']->id, 'kind' => 'item_changed', 'project_id' => $w['item']->project_id,
        'work_item_id' => $w['item']->id, 'data' => '{"fields":["title"]}', 'inbox' => true, 'dedupe_key' => "block:{$n}",
        'read_at' => $read, 'created_at' => $read, 'updated_at' => $read,
    ], range(1, PruneNotifications::BLOCK + 1)));

    expect($prune())->toBe(PruneNotifications::BLOCK + 1)
        ->and(Notification::query()->count())->toBe(0);
});

it('prunes every hour on the default queue, never twice at once', function () use ($world, $line) {
    $w = $world();
    $line($w, ['read_at' => now()->subDays(91)]);
    $task = collect(app(Schedule::class)->events())->sole(fn ($event) => $event->description === PruneNotificationsJob::class);

    (new PruneNotificationsJob)->handle();

    expect($task->expression)->toBe('0 * * * *')
        ->and($task->withoutOverlapping)->toBeTrue()
        ->and($task->expiresAt)->toBe(60)
        ->and((new PruneNotificationsJob)->queue)->toBeNull()
        ->and(collect((new PruneNotificationsJob)->middleware())->sole())->toBeInstanceOf(WithoutOverlapping::class)
        ->and(Notification::query()->count())->toBe(0);
});
