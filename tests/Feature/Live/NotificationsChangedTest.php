<?php

use App\Access\ProjectRole;
use App\Actions\Comments\AddComment;
use App\Actions\Notifications\NotifyRecipients;
use App\Actions\Notifications\SaveNotificationPreferences;
use App\Actions\Notifications\SendDueReminders;
use App\Actions\WorkItems\SetSubscription;
use App\Events\EventType;
use App\Jobs\SendNotificationMailJob;
use App\Live\NotificationsChanged;
use App\Models\Notification;
use App\Models\Organization;
use App\Models\Project;
use App\Models\User;
use App\Models\WorkItem;
use App\Notifications\NotificationConsumer;
use App\Support\Actor;
use Carbon\CarbonImmutable;
use Illuminate\Broadcasting\BroadcastException;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Exceptions;
use Illuminate\Support\Facades\Mail;
use Illuminate\Support\Facades\Queue;

/*
 * `notifications.changed` on the presence channel of a person (Task 10, K1, K10): the badge and the inbox of every tab
 * load again when new notifications arrive (consumer, reminders) or another tab of the person reads, unreads or deletes
 * one. The tab that did it is left out; nothing goes out before the commit, and a Reverb that is down never fails the
 * request. WEB (public) with Tom as its lead and Mara and Ida as members.
 */

beforeEach(fn () => $this->live = broadcasts());

$world = function (): array {
    $tom = User::factory()->create(['name' => 'Tom']);
    $web = Project::factory()->identifier('WEB')->public()->member($tom, ProjectRole::Admin)->create(['lead_id' => $tom->id]);
    $mara = memberOf($web, ProjectRole::Member, ['name' => 'Mara']);
    $ida = memberOf($web, ProjectRole::Member, ['name' => 'Ida']);
    $item = WorkItem::factory()->for($web)->create(['created_by' => $tom->id]);

    return compact('tom', 'web', 'mara', 'ida', 'item');
};

/** What a person hears when their notifications changed: no ID beyond the channel (A279). */
$changed = fn (User $user, ?string $socket = null) => [
    'channels' => ["presence-user.{$user->id}"],
    'event' => 'live',
    'payload' => ['event_id' => null, 'type' => 'notifications.changed', 'project_id' => null, 'item_id' => null, 'comment_id' => null, 'actor_id' => null, 'unread_changed' => true],
    'socket' => $socket,
];

it('tells a person whose inbox grew', function () use ($world, $changed) {
    $w = $world();
    SetSubscription::run(actor($w['mara']), $w['item'], true);
    consumers(NotificationConsumer::class);

    AddComment::run(actor($w['ida']), $w['item'], ['body' => 'Das Formular ist live.']);

    // the lead and the watcher, never the author
    expect(Notification::query()->count())->toBe(2)
        ->and($this->live->sent())->toEqualCanonicalizing([$changed($w['tom']), $changed($w['mara'])]);
});

it('tells nobody of a notification for mail only', function () use ($world, $changed) {
    $w = $world();
    config(['mail.default' => 'smtp']);
    Mail::fake();
    Queue::fake([SendNotificationMailJob::class]);
    SaveNotificationPreferences::run(actor($w['tom']), ['preferences' => [['event' => 'comment', 'channel' => 'inbox', 'enabled' => false]]]);
    SetSubscription::run(actor($w['mara']), $w['item'], true);
    consumers(NotificationConsumer::class);

    AddComment::run(actor($w['ida']), $w['item'], ['body' => 'Das Formular ist live.']);

    expect(Notification::query()->where('user_id', $w['tom']->id)->sole()->inbox)->toBeFalse()
        ->and($this->live->sent())->toBe([$changed($w['mara'])]);
});

it('tells nobody who turned the kind off', function () use ($world) {
    $w = $world();
    SaveNotificationPreferences::run(actor($w['tom']), ['preferences' => [['event' => 'comment', 'channel' => 'inbox', 'enabled' => false]]]);
    consumers(NotificationConsumer::class);

    AddComment::run(actor($w['ida']), $w['item'], ['body' => 'Das Formular ist live.']);

    // no mail server: the lead's only channel is off, no row and no message
    expect(Notification::query()->count())->toBe(0)
        ->and($this->live->sent())->toBe([]);
});

it('tells nobody again when an event arrives twice', function () use ($world, $changed) {
    $w = $world();
    AddComment::run(actor($w['ida']), $w['item'], ['body' => 'Das Formular ist live.']);
    $event = eventsOf(EventType::CommentCreated, $w['item'])->sole();
    $notify = fn () => NotifyRecipients::run(Actor::system(User::defaultBot(), 'notifications'), $event);

    // past the claim of the outbox (a retry after the claim rolled back): the rows exist, nobody hears again
    expect($notify())->toBe(1)
        ->and($notify())->toBe(0)
        ->and($this->live->sent())->toBe([$changed($w['tom'])]);
});

it('tells a person reminded at 08:00', function () use ($world, $changed) {
    $w = $world();
    Organization::current()->update(['timezone' => 'Europe/Berlin']);
    config(['mail.default' => 'smtp']);
    Mail::fake();
    Queue::fake([SendNotificationMailJob::class]);
    WorkItem::factory()->for($w['web'])->create(['assignee_id' => $w['mara']->id, 'due_date' => '2026-11-03', 'created_by' => $w['mara']->id]);
    // Ida reads her reminders by mail only: no inbox, nothing to tell
    SaveNotificationPreferences::run(actor($w['ida']), ['preferences' => [['event' => 'due', 'channel' => 'inbox', 'enabled' => false]]]);
    WorkItem::factory()->for($w['web'])->create(['assignee_id' => $w['ida']->id, 'due_date' => '2026-11-03', 'created_by' => $w['ida']->id]);
    $this->travelTo(CarbonImmutable::parse('2026-11-03 07:00', 'UTC'));
    $remind = fn () => SendDueReminders::run(Actor::system(User::defaultBot(), 'due_reminders'), now()->utc()->startOfHour()->toImmutable());

    expect($remind())->toBe(2)
        ->and(Notification::query()->where('user_id', $w['ida']->id)->sole()->inbox)->toBeFalse()
        ->and($this->live->sent())->toBe([$changed($w['mara'])]);

    // a second run in the hour writes nothing and tells nobody again
    expect($remind())->toBe(0)
        ->and($this->live->sent())->toHaveCount(1);
});

it('tells the other tabs of a person who marked read', function () use ($world, $changed) {
    $w = $world();
    $one = Notification::factory()->forItem($w['item'])->create(['user_id' => $w['mara']->id]);
    $two = Notification::factory()->forItem($w['item'])->create(['user_id' => $w['mara']->id]);
    $tab = fn () => $this->actingAs($w['mara'])->withHeader('X-Socket-ID', '1234.5678');

    $tab()->postJson('/api/v1/notifications/read', ['ids' => [$one->id]])->assertOk()->assertJson(['updated' => 1]);
    $tab()->postJson('/api/v1/notifications/unread', ['ids' => [$one->id]])->assertOk()->assertJson(['updated' => 1]);
    $tab()->postJson('/api/v1/notifications/read', ['all' => true])->assertOk()->assertJson(['updated' => 2]);
    $tab()->deleteJson("/api/v1/notifications/{$two->id}")->assertNoContent();

    expect($this->live->sent())->toBe(array_fill(0, 4, $changed($w['mara'], '1234.5678')));
});

it('tells nobody when nothing changed', function () use ($world) {
    $w = $world();
    $read = Notification::factory()->forItem($w['item'])->create(['user_id' => $w['mara']->id, 'read_at' => now()]);
    $foreign = Notification::factory()->forItem($w['item'])->create(['user_id' => $w['ida']->id]);
    $tab = fn () => $this->actingAs($w['mara']);

    $tab()->postJson('/api/v1/notifications/read', ['ids' => [$read->id, $foreign->id]])->assertOk()->assertJson(['updated' => 0]);
    $tab()->postJson('/api/v1/notifications/unread', ['ids' => [$foreign->id]])->assertOk()->assertJson(['updated' => 0]);
    $tab()->postJson('/api/v1/notifications/read', ['all' => true])->assertOk()->assertJson(['updated' => 0]);
    NotificationsChanged::dispatchFor([], null);

    expect($this->live->sent())->toBe([]);
});

it('tells only after the commit', function () use ($world, $changed) {
    $w = $world();

    try {
        DB::transaction(function () use ($w) {
            NotificationsChanged::dispatchFor([$w['mara']->id], null);
            expect($this->live->sent())->toBe([]);

            throw new RuntimeException('rolled back');
        });
    } catch (RuntimeException) {
    }
    expect($this->live->sent())->toBe([]);

    DB::transaction(function () use ($w) {
        NotificationsChanged::dispatchFor([$w['mara']->id, $w['ida']->id], '1234.5678');
        expect($this->live->sent())->toBe([]);
    });
    expect($this->live->sent())->toBe([$changed($w['mara'], '1234.5678'), $changed($w['ida'], '1234.5678')]);
});

it('keeps marking read at 200 when Reverb is down', function () use ($world) {
    $w = $world();
    $one = Notification::factory()->forItem($w['item'])->create(['user_id' => $w['mara']->id]);
    Exceptions::fake();
    $this->live->failWith(new BroadcastException('Pusher error: cURL error 28: Operation timed out.'));

    $this->actingAs($w['mara'])->postJson('/api/v1/notifications/read', ['ids' => [$one->id]])->assertOk()->assertJson(['updated' => 1]);

    expect($one->fresh()?->read_at)->not->toBeNull();
    Exceptions::assertReportedCount(1);
});
