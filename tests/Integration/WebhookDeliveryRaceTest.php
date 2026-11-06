<?php

use App\Access\ProjectRole;
use App\Actions\Webhooks\PrepareWebhookAttempt;
use App\Actions\Webhooks\QueueDeliveries;
use App\Actions\Webhooks\RecordWebhookAttempt;
use App\Actions\WorkItems\CreateWorkItem;
use App\Events\EventType;
use App\Events\Outbox;
use App\Jobs\DeliverWebhook;
use App\Models\Event;
use App\Models\Project;
use App\Models\User;
use App\Models\Webhook;
use App\Models\WebhookAttempt;
use App\Models\WebhookDelivery;
use App\Support\Actor;
use App\Webhooks\WebhookConsumer;
use Illuminate\Database\QueryException;
use Illuminate\Support\Facades\Queue;
use Tests\Support\RaceConnections;

/*
 * Two at work on one event (task 6, Review Focus 1, K16): `mariadb` holds a consumer that has just written the
 * deliveries, like a job in progress; `mariadb_second` is a second consumer of the same event (a redispatch), a second
 * QueueDeliveries without the claim (queue:retry), or a failing attempt that switches the webhook off (RecordWebhookAttempt,
 * both ways round), and gives up waiting for a lock after one second.
 */

beforeEach(function () {
    RaceConnections::setUp();
    Queue::fake([DeliverWebhook::class]);
});

afterEach(fn () => RaceConnections::tearDown());

/** Two webhooks of the organization and the `work_item.created` of an item of WEB. */
$world = function (): array {
    $mara = User::factory()->create(['name' => 'Mara']);
    $web = Project::factory()->public()->member($mara, ProjectRole::Admin)->create(['lead_id' => $mara->id]);
    $webhooks = Webhook::factory()->count(2)->create();
    $item = CreateWorkItem::run(actor($mara), ['project_id' => $web->id, 'title' => 'Formular prüfen']);

    return ['webhooks' => $webhooks, 'event' => eventsOf(EventType::WorkItemCreated, $item)->sole()];
};

$consume = fn (Event $event) => fn () => app(Outbox::class)->consume($event->id, WebhookConsumer::class);

$queue = fn (Event $event) => fn () => QueueDeliveries::run(Actor::system(User::defaultBot(), 'webhooks'), $event);

it('queues one delivery per webhook when two consumers take the same event', function () use ($world, $consume) {
    $w = $world();

    expect(RaceConnections::hold($consume($w['event'])))->toBeTrue();

    // the second one waits at the claim of the first ...
    $claim = 'insert into `event_consumptions`';
    $waited = RaceConnections::second($consume($w['event']));
    expect($waited)->toBeInstanceOf(QueryException::class)
        ->and($waited->getSql())->toStartWith($claim);

    // ... and finds the event taken once the first one committed
    RaceConnections::releaseBefore($claim);
    expect(RaceConnections::second($consume($w['event'])))->toBeFalse()
        ->and(WebhookDelivery::query()->count())->toBe(2)
        ->and(WebhookDelivery::query()->pluck('webhook_id')->sort()->values()->all())->toBe($w['webhooks']->modelKeys());
    Queue::assertPushed(DeliverWebhook::class, 2);
});

it('queues one job per webhook when two QueueDeliveries of one event run without the claim', function () use ($world, $queue) {
    $w = $world();

    expect(RaceConnections::hold($queue($w['event'])))->toBe(2);

    // the second insert waits for the rows of the first (their unique key) ...
    $insert = 'insert ignore into `webhook_deliveries`';
    $waited = RaceConnections::second($queue($w['event']));
    expect($waited)->toBeInstanceOf(QueryException::class)
        ->and($waited->getSql())->toStartWith($insert);

    // ... then inserts nothing and queues nothing: its own ULIDs are not in the table
    RaceConnections::releaseBefore($insert);
    expect(RaceConnections::second($queue($w['event'])))->toBe(0)
        ->and(WebhookDelivery::query()->count())->toBe(2);
    Queue::assertPushed(DeliverWebhook::class, 2);
});

/** A pending delivery of the webhook whose try fails 24 hours after its first failure: it switches the webhook off. */
$failing = function (Webhook $webhook): Closure {
    $webhook->update(['failing_since' => now()->subDay()->subMinute()]);
    $delivery = WebhookDelivery::factory()->for($webhook)->create(['event_id' => null]);

    return fn () => RecordWebhookAttempt::run(Actor::system(User::defaultBot(), 'webhooks'), $delivery->id, 500, 80, 'down', null, WebhookAttempt::SCHEDULED, false);
};

it('lets a failing attempt that switches the webhook off wait for a consumer, and cancels what it queued', function () use ($world, $consume, $failing) {
    $w = $world();
    $webhook = $w['webhooks']->first();
    $fail = $failing($webhook);

    RaceConnections::hold($consume($w['event']));

    // the consumer holds the webhook shared for the foreign key of its rows: the attempt waits for its lock ...
    RaceConnections::expectLockWait(RaceConnections::second($fail), 'webhooks');

    // ... and then switches it off and cancels the delivery the consumer just wrote
    RaceConnections::releaseBeforeLock('webhooks');
    expect(RaceConnections::second($fail))->toBeInstanceOf(WebhookAttempt::class)
        ->and($webhook->fresh()->active)->toBeFalse()
        ->and(eventsOf(EventType::WebhookDisabled, $webhook))->toHaveCount(1)
        ->and(WebhookDelivery::query()->where('webhook_id', $webhook->id)->pluck('status')->unique()->all())->toBe([WebhookDelivery::CANCELLED])
        ->and(WebhookDelivery::query()->where('webhook_id', '!=', $webhook->id)->sole()->status)->toBe(WebhookDelivery::PENDING);
});

it('lets a consumer wait for an attempt that switches the webhook off, and its delivery never goes out', function () use ($world, $consume, $failing) {
    $w = $world();
    $webhook = $w['webhooks']->first();
    $fail = $failing($webhook);

    RaceConnections::hold($fail);

    // the attempt holds the webhook exclusively: the insert of the consumer waits for it (the foreign key) ...
    $insert = 'insert ignore into `webhook_deliveries`';
    RaceConnections::expectLockWait(RaceConnections::second($consume($w['event'])), 'webhook_deliveries', $insert, ')');

    // ... then writes its delivery as pending: it read the webhook before it went off, but its try stops at once
    RaceConnections::releaseBefore($insert);
    expect(RaceConnections::second($consume($w['event'])))->toBeTrue();
    $queued = WebhookDelivery::query()->where('webhook_id', $webhook->id)->whereNotNull('event_id')->sole();
    expect($queued->status)->toBe(WebhookDelivery::PENDING)
        ->and(PrepareWebhookAttempt::run(Actor::system(User::defaultBot(), 'webhooks'), $queued->id, WebhookAttempt::SCHEDULED))->toBeNull()
        ->and($queued->fresh()->status)->toBe(WebhookDelivery::CANCELLED)
        ->and(eventsOf(EventType::WebhookDisabled, $webhook))->toHaveCount(1);
});
