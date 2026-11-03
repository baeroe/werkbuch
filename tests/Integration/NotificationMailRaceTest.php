<?php

use App\Access\ProjectRole;
use App\Actions\Comments\AddComment;
use App\Actions\Notifications\SendNotificationMail;
use App\Actions\WorkItems\SetSubscription;
use App\Events\EventType;
use App\Events\Outbox;
use App\Jobs\SendNotificationMailJob;
use App\Mail\NotificationDigest;
use App\Models\Notification;
use App\Models\NotificationMail;
use App\Models\Project;
use App\Models\User;
use App\Models\WorkItem;
use App\Notifications\NotificationConsumer;
use App\Support\Actor;
use Illuminate\Support\Facades\Mail;
use Illuminate\Support\Facades\Queue;
use Tests\Support\RaceConnections;

/*
 * Two at work on one mail collection (Task 7, Review Focus 1, K7): `mariadb` holds a job that has just sent the
 * collection, like a job in progress; `mariadb_second` is a second job of the same collection, or the consumer with a
 * new line for it, and gives up waiting for a lock after one second. A mail server is set, nothing leaves (Mail::fake).
 */

beforeEach(function () {
    RaceConnections::setUp();
    config(['mail.default' => 'smtp']);
    Mail::fake();
    Queue::fake([SendNotificationMailJob::class]);
});

afterEach(fn () => RaceConnections::tearDown());

/** Mara watches an item of WEB and has an open collection with Ida's first comment in it. */
$world = function (): array {
    $mara = User::factory()->create(['name' => 'Mara', 'email' => 'mara@example.com']);
    $web = Project::factory()->public()->member($mara, ProjectRole::Admin)->create(['lead_id' => $mara->id]);
    $ida = User::factory()->create(['name' => 'Ida']);
    $item = WorkItem::factory()->for($web)->create(['created_by' => $mara->id]);
    SetSubscription::run(actor($mara), $item, true);
    AddComment::run(actor($ida), $item, ['body' => 'Erster Hinweis.']);
    app(Outbox::class)->consume(eventsOf(EventType::CommentCreated, $item)->sole()->id, NotificationConsumer::class);

    return ['mara' => $mara, 'ida' => $ida, 'item' => $item, 'mail' => NotificationMail::query()->sole()];
};

$send = fn (NotificationMail $mail) => fn () => SendNotificationMail::run(Actor::system(User::defaultBot(), 'notification_mail'), $mail->id);

it('sends one mail when two jobs take the same collection', function () use ($world, $send) {
    $w = $world();

    expect(RaceConnections::hold($send($w['mail'])))->toBe(NotificationMail::SENT);

    // the second job waits for the lock on the collection ...
    RaceConnections::expectLockWait(RaceConnections::second($send($w['mail'])), 'notification_mails');

    // ... and finds it sent once the first one committed
    RaceConnections::releaseBeforeLock('notification_mails');
    expect(RaceConnections::second($send($w['mail'])))->toBe(SendNotificationMail::ALREADY);

    Mail::assertSent(NotificationDigest::class, 1);
    expect($w['mail']->refresh()->outcome)->toBe(NotificationMail::SENT);
});

it('puts a notification that arrives while the collection is being sent into a new collection', function () use ($world, $send) {
    $w = $world();
    AddComment::run(actor($w['ida']), $w['item'], ['body' => 'Zweiter Hinweis.']);
    $second = eventsOf(EventType::CommentCreated, $w['item'])->last();
    $consume = fn () => app(Outbox::class)->consume((string) $second?->id, NotificationConsumer::class);

    RaceConnections::hold($send($w['mail']));

    // the consumer cannot slip its line into the collection being sent: opening it waits for the send (the unique
    // `open_key` the job is closing) ...
    $opening = 'insert ignore into `notification_mails`';
    RaceConnections::expectLockWait(RaceConnections::second($consume), 'notification_mails', $opening, ')');
    expect(Notification::query()->count())->toBe(1);

    // ... and once the mail went, the line opens a new collection
    RaceConnections::releaseBefore($opening);
    RaceConnections::second($consume);

    $mails = NotificationMail::query()->orderBy('created_at')->orderBy('id')->get();
    $new = $mails->firstWhere('id', '!=', $w['mail']->id);
    expect($mails)->toHaveCount(2)
        ->and($w['mail']->refresh()->sent_at)->not->toBeNull()
        ->and($new?->sent_at)->toBeNull()
        ->and($new?->open_key)->toBe("{$w['mara']->id}:item:{$w['item']->id}")
        ->and(Notification::query()->where('mail_id', $w['mail']->id)->count())->toBe(1)
        ->and(Notification::query()->where('mail_id', $new?->id)->count())->toBe(1);
    Queue::assertPushed(SendNotificationMailJob::class, fn (SendNotificationMailJob $job) => $job->mailId === $new?->id);
});
