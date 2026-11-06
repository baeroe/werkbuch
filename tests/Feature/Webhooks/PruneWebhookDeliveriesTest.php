<?php

use App\Actions\Webhooks\PruneWebhookDeliveries;
use App\Domain\Webhooks\Backoff;
use App\Jobs\PruneWebhookDeliveriesJob;
use App\Models\User;
use App\Models\Webhook;
use App\Models\WebhookAttempt;
use App\Models\WebhookDelivery;
use App\Support\Actor;
use Illuminate\Console\Scheduling\Schedule;
use Illuminate\Queue\Middleware\WithoutOverlapping;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;

/*
 * The log of the deliveries stays 30 days after its last change, with its attempts (task 10, K15); a delivery that waits
 * is not tidied up, unless its job got lost: 36 hours after its last activity (the longest pause of the back-off and a
 * day more), while the queue `webhooks` holds no job that is due, it is `failed`, without an event and without
 * switching anything off.
 */

beforeEach(fn () => $this->travelTo('2026-11-05 12:00:00'));

$system = fn (): Actor => Actor::system(User::defaultBot(), 'prune_webhooks');

/** A delivery of the status, last changed at `$changed`, created at `$created`. */
$delivery = function (Webhook $webhook, string $status, string $changed, ?string $created = null): WebhookDelivery {
    $delivery = WebhookDelivery::factory()->create(['webhook_id' => $webhook->id, 'status' => $status, 'attempts' => 1]);
    DB::table('webhook_deliveries')->where('id', $delivery->id)->update([
        'updated_at' => $changed, 'created_at' => $created ?? $changed,
    ]);

    return $delivery;
};

it('keeps a delivery of 30 days minus a second and deletes one of 30 days with its attempts', function () use ($system, $delivery) {
    $webhook = Webhook::factory()->create();
    $young = $delivery($webhook, WebhookDelivery::SUCCEEDED, '2026-10-06 12:00:01');
    $old = $delivery($webhook, WebhookDelivery::SUCCEEDED, '2026-10-06 12:00:00');
    $failed = $delivery($webhook, WebhookDelivery::FAILED, '2026-09-01 00:00:00');
    $cancelled = $delivery($webhook, WebhookDelivery::CANCELLED, '2026-09-01 00:00:00');
    WebhookAttempt::factory()->create(['delivery_id' => $old->id, 'webhook_id' => $webhook->id]);
    WebhookAttempt::factory()->create(['delivery_id' => $young->id, 'webhook_id' => $webhook->id]);

    expect(PruneWebhookDeliveries::run($system()))->toBe(3)
        ->and(WebhookDelivery::query()->pluck('id')->all())->toBe([$young->id])
        ->and(WebhookAttempt::query()->pluck('delivery_id')->all())->toBe([$young->id])
        ->and($failed->exists())->toBeTrue();
});

it('keeps a delivery that waits', function () use ($system, $delivery) {
    $webhook = Webhook::factory()->create();
    $pending = $delivery($webhook, WebhookDelivery::PENDING, '2026-11-05 11:00:00');

    expect(PruneWebhookDeliveries::run($system()))->toBe(0)
        ->and($pending->fresh()->status)->toBe(WebhookDelivery::PENDING);
});

it('finishes a delivery whose job got lost, 36 hours after its last activity, and removes it 30 days later', function () use ($system, $delivery) {
    $webhook = Webhook::factory()->create();
    $waiting = $delivery($webhook, WebhookDelivery::PENDING, '2026-11-04 00:00:00');
    $lost = $delivery($webhook, WebhookDelivery::PENDING, '2026-11-03 23:59:59');
    DB::table('webhooks')->where('id', $webhook->id)->update(['updated_at' => '2026-11-01 00:00:00']);
    $events = DB::table('events')->count();

    PruneWebhookDeliveries::run($system());

    expect($lost->fresh()->status)->toBe(WebhookDelivery::FAILED)
        ->and($waiting->fresh()->status)->toBe(WebhookDelivery::PENDING)
        ->and($webhook->fresh()->active)->toBeTrue()
        ->and($webhook->fresh()->updated_at->toDateTimeString())->toBe('2026-11-01 00:00:00')
        ->and(DB::table('events')->count())->toBe($events);

    $this->travelTo('2026-12-05 12:00:01');
    // the one that waited is finished by this run, so it stays another 30 days
    expect(PruneWebhookDeliveries::run($system()))->toBe(1)
        ->and(WebhookDelivery::query()->pluck('id')->all())->toBe([$waiting->id])
        ->and($waiting->fresh()->status)->toBe(WebhookDelivery::FAILED);
});

it('deletes in blocks of 500', function () use ($system) {
    $webhook = Webhook::factory()->create();
    $rows = collect(range(1, 501))->map(fn () => [
        'id' => (string) Str::ulid(), 'webhook_id' => $webhook->id, 'event_id' => null, 'event' => 'ping', 'body' => '{}',
        'status' => WebhookDelivery::SUCCEEDED, 'attempts' => 1, 'created_at' => '2026-09-01 00:00:00', 'updated_at' => '2026-09-01 00:00:00',
    ])->all();
    DB::table('webhook_deliveries')->insert($rows);

    expect(PruneWebhookDeliveries::run($system()))->toBe(501);
});

it('runs every hour as a job that never runs twice at once', function () use ($delivery) {
    $delivery(Webhook::factory()->create(), WebhookDelivery::SUCCEEDED, '2026-09-01 00:00:00');
    $task = collect(app(Schedule::class)->events())->sole(fn ($event) => $event->description === PruneWebhookDeliveriesJob::class);

    (new PruneWebhookDeliveriesJob)->handle();

    expect($task->expression)->toBe('0 * * * *')
        ->and($task->withoutOverlapping)->toBeTrue()
        ->and($task->expiresAt)->toBe(60)
        ->and(collect((new PruneWebhookDeliveriesJob)->middleware())->sole())->toBeInstanceOf(WithoutOverlapping::class)
        ->and(WebhookDelivery::query()->count())->toBe(0);
});

it('measures a lost delivery from its last attempt, not from its creation (T10-M2)', function () use ($system, $delivery) {
    $webhook = Webhook::factory()->create();
    // created three days ago, tried last 35 hours ago: its next try is still to come
    $tried = $delivery($webhook, WebhookDelivery::PENDING, '2026-11-04 01:00:00', '2026-11-02 12:00:00');

    PruneWebhookDeliveries::run($system());

    expect($tried->fresh()->status)->toBe(WebhookDelivery::PENDING);
});

it('takes no delivery for lost while the queue webhooks has jobs that are due (T10-M2)', function () use ($system, $delivery) {
    $webhook = Webhook::factory()->create();
    $waiting = $delivery($webhook, WebhookDelivery::PENDING, '2026-11-03 11:00:00');
    $job = fn (string $queue, int $available, ?int $reserved = null) => DB::table('jobs')->insertGetId([
        'queue' => $queue, 'payload' => '{}', 'attempts' => 0, 'reserved_at' => $reserved, 'available_at' => $available, 'created_at' => $available,
    ]);
    // a worker died two days ago: its job waits in the queue, and default (this run) comes before webhooks
    $job('webhooks', now()->subDays(2)->getTimestamp());

    PruneWebhookDeliveries::run($system());
    expect($waiting->fresh()->status)->toBe(WebhookDelivery::PENDING);

    // jobs of other queues, later ones and one a worker holds right now are no backlog of webhooks
    DB::table('jobs')->delete();
    $job('default', now()->subDays(2)->getTimestamp());
    $job('webhooks', now()->addHour()->getTimestamp());
    $job('webhooks', now()->subMinute()->getTimestamp(), now()->subSeconds(10)->getTimestamp());

    PruneWebhookDeliveries::run($system());
    expect($waiting->fresh()->status)->toBe(WebhookDelivery::FAILED);
});

it('waits the longest pause of the back-off and a day for a lost delivery', function () {
    $pauses = array_map(fn (int $attempt) => Backoff::delayAfter($attempt), range(1, 7));

    expect(PruneWebhookDeliveries::LOST_AFTER_SECONDS)->toBe(max($pauses) + 86400);
});
