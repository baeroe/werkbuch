<?php

use App\Events\Outbox;
use App\Jobs\ConsumeEvent;
use App\Live\LiveConsumer;
use App\Models\Event;
use App\Models\Webhook;
use App\Models\WebhookDelivery;
use App\Notifications\NotificationConsumer;
use App\Search\SearchConsumer;
use App\Webhooks\WebhookConsumer;
use Illuminate\Support\Facades\Queue;

/*
 * The consumer `webhooks` (task 6): its queue and tries; it hands every event to QueueDeliveries and computes nothing.
 */

it('is a consumer of every event, in the queue webhooks, with the tries of the search', function () {
    $consumer = new WebhookConsumer;

    expect(config('werkbuch.event_consumers'))->toBe([])        // off in tests until a test switches it on (K2)
        ->and((require repo_path('config/werkbuch.php'))['event_consumers'])
        ->toBe([SearchConsumer::class, NotificationConsumer::class, LiveConsumer::class, WebhookConsumer::class])
        ->and($consumer->key())->toBe('webhooks')
        ->and($consumer->queue())->toBe('webhooks')
        ->and($consumer->tries())->toBe(8)
        ->and($consumer->backoff())->toBe([10, 60, 300, 900, 3600]);
});

it('puts its job in the queue webhooks', function () {
    $event = Event::query()->firstOrFail();
    consumers(WebhookConsumer::class);
    Queue::fake();

    app(Outbox::class)->dispatch($event->id);

    Queue::assertPushedOn('webhooks', ConsumeEvent::class, fn (ConsumeEvent $job) => $job->consumer === WebhookConsumer::class
        && $job->eventId === $event->id);
});

it('takes the events of the migrations without deliveries', function () {
    Webhook::factory()->create(['events' => Webhook::catalog()]);
    $events = Event::query()->get();

    expect($events->pluck('type')->map->value->all())->toContain('bot.created', 'workflow.created')
        ->and($events->map(fn (Event $event) => app(Outbox::class)->consume($event->id, WebhookConsumer::class))->unique()->all())->toBe([true])
        ->and(WebhookDelivery::query()->count())->toBe(0);
});
