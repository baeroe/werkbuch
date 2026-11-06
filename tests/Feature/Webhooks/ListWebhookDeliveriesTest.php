<?php

use App\Actions\Webhooks\ListWebhookDeliveries;
use App\Models\User;
use App\Models\Webhook;
use App\Models\WebhookAttempt;
use App\Models\WebhookDelivery;
use Illuminate\Support\Facades\DB;

// The log of a webhook (task 9): its attempts, the newest first, two in one second apart by their microseconds.

$list = fn (Webhook $webhook, array $query = []) => ListWebhookDeliveries::run(actor(User::factory()->admin()->create()), $webhook, $query);

it('lists the attempts of the webhook, the newest first', function () use ($list) {
    $webhook = Webhook::factory()->create();
    $delivery = WebhookDelivery::factory()->for($webhook)->create(['event' => 'work_item.updated']);
    $old = WebhookAttempt::factory()->for($delivery, 'delivery')->create(['attempted_at' => '2026-11-05 10:00:00.000000']);
    $new = WebhookAttempt::factory()->for($delivery, 'delivery')->create(['attempt' => 2, 'attempted_at' => '2026-11-05 11:00:00.000000']);
    WebhookAttempt::factory()->create(); // of another webhook

    $result = $list($webhook);

    expect($result->total)->toBe(2)
        ->and(collect($result->page->items())->pluck('id')->all())->toBe([$new->id, $old->id])
        ->and($result->page->items()[0]->delivery->event)->toBe('work_item.updated');
});

it('orders two attempts of one second by their microseconds and pages them without repeating one', function () use ($list) {
    $webhook = Webhook::factory()->create();
    $delivery = WebhookDelivery::factory()->for($webhook)->create();
    $make = fn (int $n, string $at) => WebhookAttempt::factory()->for($delivery, 'delivery')->create(['attempt' => $n, 'attempted_at' => $at]);
    $a = $make(1, '2026-11-05 10:00:00.100000');
    $b = $make(2, '2026-11-05 10:00:00.200000');
    $c = $make(3, '2026-11-05 10:00:00.300000');

    $first = $list($webhook, ['per_page' => 2]);
    $second = $list($webhook, ['per_page' => 2, 'cursor' => $first->page->nextCursor()?->encode()]);

    expect(collect($first->page->items())->pluck('id')->all())->toBe([$c->id, $b->id])
        ->and(collect($second->page->items())->pluck('id')->all())->toBe([$a->id]);
});

it('asks the database as often for 5 attempts as for 50', function () use ($list) {
    $webhook = Webhook::factory()->create();
    $delivery = WebhookDelivery::factory()->for($webhook)->create();
    $count = function () use ($list, $webhook): int {
        DB::flushQueryLog();
        DB::enableQueryLog();
        $list($webhook, ['per_page' => 100]);

        return count(DB::getQueryLog());
    };
    WebhookAttempt::factory()->count(5)->for($delivery, 'delivery')->create();
    $few = $count();
    WebhookAttempt::factory()->count(45)->for($delivery, 'delivery')->create();

    expect($count())->toBe($few);
});

it('lets only accounts with org.manage read the log', function () {
    $webhook = Webhook::factory()->create();

    expect(problemOf(fn () => ListWebhookDeliveries::run(actor(User::factory()->create()), $webhook, []))->status)->toBe(403);
});
