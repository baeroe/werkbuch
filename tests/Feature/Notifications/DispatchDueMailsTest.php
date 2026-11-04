<?php

use App\Access\ProjectRole;
use App\Actions\Notifications\DispatchDueMails;
use App\Actions\Notifications\NotifyRecipients;
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
use Illuminate\Support\Facades\Exceptions;
use Illuminate\Support\Facades\Mail;
use Illuminate\Support\Facades\Queue;
use Symfony\Component\Mailer\Exception\TransportException;
use Tests\Support\ScriptedTransport;

/*
 * The sweeper of the mail collections (Task 7, A288, K8): `app:send-notification-mails` puts a collection that lost its
 * job on the queue again, only when no try of its job ran for 35 minutes, and sends every open one with `--now`. Mara watches an item of WEB;
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

$sweep = fn (bool $now = false) => DispatchDueMails::run(Actor::system(User::defaultBot(), 'notification_mail'), $now)['taken'];

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

it('dispatches a collection again only when no try of its job ran for 35 minutes', function () use ($world, $collection, $sweep, $pushed) {
    Queue::fake([SendNotificationMailJob::class]);
    $w = $world();
    // SMTP is down: the last try of the job was half an hour ago, its next one (after a pause of 30 minutes) is due
    $mail = $collection($w, ['due_at' => now()->subHour(), 'dispatched_at' => now()->subMinutes(30)]);

    expect($sweep())->toBe(0);

    // no try for 36 minutes: the job is gone (failed_jobs, a lost dispatch)
    $this->travel(6)->minutes();
    expect($sweep())->toBe(1);

    $this->travel(1)->minutes();
    expect($sweep())->toBe(0);

    $this->travel(DispatchDueMails::PAUSE_MINUTES)->minutes();
    expect($sweep())->toBe(1)
        ->and($pushed())->toBe([$mail->id, $mail->id]);
});

it('waits longer than the longest pause of the job (I1)', function () {
    expect(DispatchDueMails::PAUSE_MINUTES * 60)->toBeGreaterThan(max((new SendNotificationMailJob('x'))->backoff))
        ->and((new SendNotificationMailJob('x'))->backoff)->toBe([60, 300, 900, 1800]);
});

it('takes a collection whose job was lost from 35 minutes after it was due', function () use ($world, $sweep, $pushed) {
    Queue::fake([SendNotificationMailJob::class]);
    $this->freezeTime();
    $w = $world();
    // collected now: the job comes after the delay, its first try at due_at
    NotifyRecipients::collect([$w['mara']->id], 'item:'.$w['item']->id);
    $mail = NotificationMail::query()->sole();
    expect($mail->dispatched_at?->toDateTimeString())->toBe($mail->due_at->toDateTimeString());
    Queue::fake([SendNotificationMailJob::class]);

    // the dispatch was lost (a crash after the commit): nothing within 35 minutes of due_at
    $this->travelTo($mail->due_at->addMinutes(DispatchDueMails::PAUSE_MINUTES));
    expect($sweep())->toBe(0);
    $this->travel(1)->minutes();
    expect($sweep())->toBe(1)
        ->and($pushed())->toBe([$mail->id]);
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

it('takes at most 500 collections a run, the longest due first (T7-M3)', function () use ($world, $sweep, $pushed) {
    Queue::fake([SendNotificationMailJob::class]);
    $this->freezeTime();
    $w = $world();
    $ids = [];
    foreach (range(1, DispatchDueMails::BATCH + 1) as $n) {
        $ids[] = NotificationMail::factory()->create(['user_id' => $w['mara']->id, 'scope' => "item:{$n}", 'due_at' => now()->subMinutes(10 + $n), 'dispatched_at' => null])->id;
    }

    expect($sweep())->toBe(DispatchDueMails::BATCH)
        // the last one made is due longest: it is among them, the first one made waits for the next run
        ->and($pushed())->toContain($ids[DispatchDueMails::BATCH])
        ->and($pushed())->not->toContain($ids[0]);
    expect($sweep())->toBe(1)
        ->and(Queue::pushed(SendNotificationMailJob::class)->last()->mailId)->toBe($ids[0]);
});

it('sends every other collection with --now when one fails, and ends with an error (T7-M4)', function () use ($world, $collection) {
    Exceptions::fake();
    $w = $world();
    $first = $collection($w, ['due_at' => now()->subMinutes(2)]);
    $second = $collection($w, ['due_at' => now()->subMinute(), 'scope' => 'item:other']);
    ScriptedTransport::use(function (int $attempt): void {
        if ($attempt === 1) {
            throw new TransportException('Connection could not be established.');
        }
    });

    $this->artisan('app:send-notification-mails', ['--now' => true])
        ->expectsOutput('Sent or skipped 1 open mail collections, 1 failed.')
        ->assertFailed();

    expect($first->refresh()->sent_at)->toBeNull()
        ->and($second->refresh()->outcome)->toBe(NotificationMail::SENT);
    Exceptions::assertReported(TransportException::class);
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
