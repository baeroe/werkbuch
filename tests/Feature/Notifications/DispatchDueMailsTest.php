<?php

use App\Access\ProjectRole;
use App\Actions\Notifications\DispatchDueMails;
use App\Domain\Notifications\NotificationKind;
use App\Jobs\SendNotificationMailJob;
use App\Mail\NotificationDigest;
use App\Models\Notification;
use App\Models\NotificationMail;
use App\Models\Project;
use App\Models\User;
use App\Models\WorkItem;
use App\Support\Actor;
use Illuminate\Console\Scheduling\Schedule;
use Illuminate\Support\Facades\Mail;
use Illuminate\Support\Facades\Queue;

/*
 * The sweeper of the mail collections (Task 7, A288, K8): `app:send-notification-mails` puts a collection that lost its
 * job on the queue again, at most every 15 minutes, and sends every open one with `--now`. Mara watches an item of WEB;
 * the collections are made by hand, each with a comment line.
 */

$world = function (): array {
    $mara = User::factory()->create(['name' => 'Mara', 'email' => 'mara@example.com']);
    $web = Project::factory()->identifier('WEB')->public()->member($mara, ProjectRole::Member)->create();

    return ['mara' => $mara, 'item' => WorkItem::factory()->for($web)->create(['title' => 'Kontaktformular'])];
};

/** A collection of Mara with one unread comment line, of the given state. */
$collection = function (array $w, array $attributes = []): NotificationMail {
    $mail = NotificationMail::factory()->create(['user_id' => $w['mara']->id, ...$attributes]);
    Notification::factory()->forItem($w['item'])->kind(NotificationKind::Comment)->create(['user_id' => $w['mara']->id, 'mail_id' => $mail->id]);

    return $mail;
};

$sweep = fn (bool $now = false) => DispatchDueMails::run(Actor::system(User::defaultBot(), 'notification_mail'), $now);

/** The collections the jobs on the queue are for. */
$pushed = fn () => Queue::pushed(SendNotificationMailJob::class)->map(fn (SendNotificationMailJob $job) => $job->mailId)->all();

it('dispatches the job again for a collection left behind', function () use ($world, $collection, $sweep, $pushed) {
    Queue::fake([SendNotificationMailJob::class]);
    $this->freezeTime();
    $w = $world();
    // due three minutes ago and never dispatched (a crash after the commit)
    $behind = $collection($w, ['due_at' => now()->subMinutes(3), 'dispatched_at' => null]);
    // due for a minute only: its job is probably on its way
    $collection($w, ['due_at' => now()->subMinute(), 'dispatched_at' => null]);
    // not due yet, and sent ones
    $collection($w, ['due_at' => now()->addMinutes(3)]);
    $collection($w, ['due_at' => now()->subHour()])->update(['open_key' => null, 'sent_at' => now(), 'outcome' => NotificationMail::SENT]);
    $collection($w, ['due_at' => now()->subHour()])->update(['open_key' => null, 'sent_at' => now(), 'outcome' => NotificationMail::SKIPPED]);

    expect($sweep())->toBe(1)
        ->and($pushed())->toBe([$behind->id])
        ->and($behind->refresh()->dispatched_at?->toDateTimeString())->toBe(now()->toDateTimeString());
    expect(Queue::pushed(SendNotificationMailJob::class)->sole()->queue)->toBe('notifications');
});

it('dispatches a collection again at most every 15 minutes', function () use ($world, $collection, $sweep, $pushed) {
    Queue::fake([SendNotificationMailJob::class]);
    $w = $world();
    // dispatched with its delay when it opened; SMTP is down, the job waits out its backoff
    $mail = $collection($w, ['due_at' => now()->subMinutes(3), 'dispatched_at' => now()->subMinutes(8)]);

    expect($sweep())->toBe(0);

    $this->travel(8)->minutes();
    expect($sweep())->toBe(1);

    $this->travel(1)->minutes();
    expect($sweep())->toBe(0);

    $this->travel(16)->minutes();
    expect($sweep())->toBe(1)
        ->and($pushed())->toBe([$mail->id, $mail->id]);
});

it('sends everything open with --now', function () use ($world, $collection) {
    config(['mail.default' => 'smtp']);
    Mail::fake();
    $w = $world();
    // not due yet, and one with nothing left to tell
    $open = $collection($w, ['due_at' => now()->addMinutes(4)]);
    $read = $collection($w, ['due_at' => now()->addMinutes(4), 'scope' => 'item:other']);
    Notification::query()->where('mail_id', $read->id)->update(['read_at' => now()]);
    $collection($w)->update(['open_key' => null, 'sent_at' => now(), 'outcome' => NotificationMail::SENT]);

    $this->artisan('app:send-notification-mails', ['--now' => true])
        ->expectsOutput('Sent or skipped 2 open mail collections.')
        ->assertSuccessful();

    Mail::assertSent(NotificationDigest::class, 1);
    expect($open->refresh()->outcome)->toBe(NotificationMail::SENT)
        ->and($read->refresh()->outcome)->toBe(NotificationMail::SKIPPED);
});

it('runs every minute, and the command dispatches without --now', function () use ($world, $collection) {
    Queue::fake([SendNotificationMailJob::class]);
    $w = $world();
    $collection($w, ['due_at' => now()->subMinutes(3), 'dispatched_at' => null]);

    $this->artisan('app:send-notification-mails')->expectsOutput('Dispatched 1 mail collections.')->assertSuccessful();

    Queue::assertPushed(SendNotificationMailJob::class, 1);
    $task = collect(app(Schedule::class)->events())->sole(fn ($event) => str_contains((string) $event->command, 'app:send-notification-mails'));
    expect($task->expression)->toBe('* * * * *')
        ->and($task->withoutOverlapping)->toBeTrue()
        ->and($task->expiresAt)->toBe(5);
});
