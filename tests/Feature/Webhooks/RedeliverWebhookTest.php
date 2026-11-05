<?php

use App\Actions\Webhooks\RedeliverWebhook;
use App\Models\User;
use App\Models\Webhook;
use App\Models\WebhookAttempt;
use App\Models\WebhookDelivery;
use Illuminate\Support\Facades\Http;

/*
 * "Send again" (task 9, A367, K6): the same body and the same X-Werkbuch-Delivery with a new timestamp, one more attempt
 * on the log, also to a webhook that is off. A failed one leaves the status, so the scheduled tries still go on.
 */

beforeEach(fn () => resolver(['receiver.example.com' => ['93.184.216.34']]));

$redeliver = fn (WebhookDelivery $delivery) => RedeliverWebhook::run(actor(User::factory()->admin()->create()), $delivery->webhook, $delivery);

it('sends the same body and delivery again and numbers the attempt on', function () use ($redeliver) {
    Http::fake(['*' => Http::response('ok')]);
    $this->freezeSecond();
    $delivery = WebhookDelivery::factory()->for(Webhook::factory()->create())->create(['body' => '{"id":"x"}', 'status' => WebhookDelivery::FAILED, 'attempts' => 3]);
    WebhookAttempt::factory()->for($delivery, 'delivery')->create(['attempt' => 3, 'attempted_at' => now()->subDay()]);
    $this->travel(5)->seconds();

    $attempt = $redeliver($delivery);

    expect($attempt->kind)->toBe(WebhookAttempt::MANUAL)
        ->and($attempt->attempt)->toBe(4)
        ->and($attempt->status_code)->toBe(200)
        ->and($delivery->fresh()->status)->toBe(WebhookDelivery::SUCCEEDED)
        ->and($delivery->fresh()->attempts)->toBe(4);
    Http::assertSent(fn ($request) => $request->body() === '{"id":"x"}'
        && $request->header('X-Werkbuch-Delivery')[0] === $delivery->id
        && (int) $request->header('X-Werkbuch-Timestamp')[0] === now()->timestamp);
});

it('answers a failed redelivery with the attempt and keeps the status', function () use ($redeliver) {
    Http::fake(['*' => Http::response('nope', 502)]);
    $delivery = WebhookDelivery::factory()->for(Webhook::factory()->create())->create(['status' => WebhookDelivery::PENDING]);

    $attempt = $redeliver($delivery);

    expect($attempt->status_code)->toBe(502)
        ->and($delivery->fresh()->status)->toBe(WebhookDelivery::PENDING);
});

it('redelivers to a disabled webhook', function () use ($redeliver) {
    Http::fake(['*' => Http::response('ok')]);
    $webhook = Webhook::factory()->disabled()->create();
    $delivery = WebhookDelivery::factory()->for($webhook)->create(['status' => WebhookDelivery::CANCELLED]);

    $attempt = $redeliver($delivery);

    expect($attempt->status_code)->toBe(200)
        ->and($delivery->fresh()->status)->toBe(WebhookDelivery::SUCCEEDED)
        ->and($webhook->fresh()->active)->toBeFalse();
});

it('does not find a delivery of another webhook', function () {
    Http::fake(['*' => Http::response('ok')]);
    $delivery = WebhookDelivery::factory()->for(Webhook::factory()->create())->create();
    $other = Webhook::factory()->create();

    $problem = problemOf(fn () => RedeliverWebhook::run(actor(User::factory()->admin()->create()), $other, $delivery));

    expect($problem->status)->toBe(404);
    Http::assertNothingSent();
});

it('counts a failed redelivery towards nothing', function () use ($redeliver) {
    Http::fake(['*' => Http::response('nope', 500)]);
    $webhook = Webhook::factory()->create();

    $redeliver(WebhookDelivery::factory()->for($webhook)->create());

    expect($webhook->fresh()->failing_since)->toBeNull()
        ->and($webhook->fresh()->active)->toBeTrue();
});

it('goes on counting past 255 attempts', function () use ($redeliver) {
    Http::fake(['*' => Http::response('ok')]);
    $delivery = WebhookDelivery::factory()->for(Webhook::factory()->create())->create(['attempts' => 255]);

    $attempt = $redeliver($delivery);

    expect($attempt->attempt)->toBe(256)
        ->and($delivery->fresh()->attempts)->toBe(256);
});

it('lets only accounts with org.manage send again', function () {
    $delivery = WebhookDelivery::factory()->for(Webhook::factory()->create())->create();

    expect(problemOf(fn () => RedeliverWebhook::run(actor(User::factory()->create()), $delivery->webhook, $delivery))->status)->toBe(403);
    Http::assertNothingSent();
});
