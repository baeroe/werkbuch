<?php

use App\Access\ProjectRole;
use App\Actions\Webhooks\QueueDeliveries;
use App\Actions\WorkItems\CreateWorkItem;
use App\Events\EventType;
use App\Events\Outbox;
use App\Jobs\DeliverWebhook;
use App\Models\Event;
use App\Models\Project;
use App\Models\User;
use App\Models\Webhook;
use App\Models\WebhookDelivery;
use App\Support\Actor;
use App\Webhooks\WebhookConsumer;
use Illuminate\Database\QueryException;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Queue;
use Tests\Support\RaceConnections;

/*
 * Two at work on one event (task 6, Review Focus 1, K16): `mariadb` holds a consumer that has just written the
 * deliveries, like a job in progress; `mariadb_second` is a second consumer of the same event (a redispatch), a second
 * QueueDeliveries without the claim (queue:retry), or a failing attempt that switches the webhook off, and gives up
 * waiting for a lock after one second.
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

it('lets a consumer and a failing attempt of the same webhook both finish without a deadlock', function () use ($world, $consume) {
    $w = $world();
    $webhook = $w['webhooks']->first();

    RaceConnections::hold($consume($w['event']));

    // what RecordWebhookAttempt (task 7) does when a try switches the webhook off: lock it, switch it off, cancel what
    // is still pending; it waits for the consumer, which holds the webhook shared for the foreign key of its rows
    RaceConnections::releaseBeforeLock('webhooks');
    $disabled = RaceConnections::second(fn () => DB::transaction(function () use ($webhook) {
        $locked = Webhook::query()->lockForUpdate()->findOrFail($webhook->id);
        $locked->update(['active' => false, 'disabled_at' => now()]);

        return WebhookDelivery::query()->where('webhook_id', $locked->id)->where('status', WebhookDelivery::PENDING)
            ->update(['status' => WebhookDelivery::CANCELLED]);
    }));

    expect($disabled)->toBe(1)
        ->and(WebhookDelivery::query()->where('webhook_id', $webhook->id)->sole()->status)->toBe(WebhookDelivery::CANCELLED)
        ->and(WebhookDelivery::query()->where('webhook_id', '!=', $webhook->id)->sole()->status)->toBe(WebhookDelivery::PENDING);
});
