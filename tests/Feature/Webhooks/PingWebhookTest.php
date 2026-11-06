<?php

use App\Actions\Webhooks\PingWebhook;
use App\Actions\Webhooks\RecordWebhookAttempt;
use App\Models\User;
use App\Models\Webhook;
use App\Models\WebhookAttempt;
use App\Models\WebhookDelivery;
use App\Webhooks\UnsafeTarget;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Http;

/*
 * The test ping (task 9, A367, K6, K17): one synchronous attempt to the receiver, logged like any other, answered with
 * the attempt. It goes to an inactive webhook too, never counts towards switching it off and sends outside any
 * transaction of its own.
 */

beforeEach(fn () => resolver(['receiver.example.com' => ['93.184.216.34']]));

$ping = fn (Webhook $webhook) => PingWebhook::run(actor(User::factory()->admin()->create()), $webhook);

it('pings and answers the attempt', function () use ($ping) {
    Http::fake(['*' => Http::response('pong', 200)]);
    $webhook = Webhook::factory()->create();

    $attempt = $ping($webhook);

    $delivery = WebhookDelivery::query()->sole();
    expect($attempt)->toBeInstanceOf(WebhookAttempt::class)
        ->and($attempt->kind)->toBe(WebhookAttempt::PING)
        ->and($attempt->status_code)->toBe(200)
        ->and($attempt->response_excerpt)->toBe('pong')
        ->and($attempt->duration_ms)->toBeGreaterThanOrEqual(0)
        ->and($attempt->attempt)->toBe(1)
        ->and($attempt->delivery_id)->toBe($delivery->id)
        ->and($delivery->event)->toBe('ping')
        ->and($delivery->event_id)->toBeNull()
        ->and($delivery->status)->toBe(WebhookDelivery::SUCCEEDED)
        ->and(json_decode($delivery->body, true))->toMatchArray(['id' => $delivery->id, 'event' => 'ping'])
        ->and(json_decode($delivery->body, true)['data']['webhook'])->toBe(['id' => $webhook->id, 'name' => $webhook->name]);
    Http::assertSent(fn ($request) => $request->header('X-Werkbuch-Event')[0] === 'ping' && $request->header('X-Werkbuch-Delivery')[0] === $delivery->id);
});

it('answers a failed ping with the attempt', function () use ($ping) {
    Http::fake(['*' => Http::response('nope', 500)]);

    $attempt = $ping(Webhook::factory()->create());

    expect($attempt->status_code)->toBe(500)
        ->and($attempt->response_excerpt)->toBe('nope')
        ->and(WebhookDelivery::query()->sole()->status)->toBe(WebhookDelivery::FAILED);
    Http::assertSentCount(1);
});

it('pings an inactive webhook too', function () use ($ping) {
    Http::fake(['*' => Http::response('ok')]);
    $webhook = Webhook::factory()->disabled()->create();

    $attempt = $ping($webhook);

    expect($attempt->status_code)->toBe(200)
        ->and($webhook->fresh()->active)->toBeFalse();
});

it('never switches off and never starts the clock on failure', function () use ($ping) {
    Http::fake(['*' => Http::response('nope', 500)]);
    $webhook = Webhook::factory()->failingSince(now()->subHours(30))->create();
    $since = $webhook->fresh()->failing_since;

    $ping($webhook);

    $fresh = $webhook->fresh();
    expect($fresh->active)->toBeTrue()
        ->and($fresh->disabled_at)->toBeNull()
        ->and($fresh->failing_since?->eq($since))->toBeTrue();

    $clean = Webhook::factory()->create();
    $ping($clean);
    expect($clean->fresh()->failing_since)->toBeNull();
});

it('clears failing_since on success', function () use ($ping) {
    Http::fake(['*' => Http::response('ok')]);
    $webhook = Webhook::factory()->failingSince(now()->subHour())->create();

    $ping($webhook);

    expect($webhook->fresh()->failing_since)->toBeNull()
        ->and($webhook->fresh()->last_success_at)->not->toBeNull();
});

it('sends to no private address', function () use ($ping) {
    Http::fake(['*' => Http::response('ok')]);
    resolver(['receiver.example.com' => ['10.0.0.5']]);

    $attempt = $ping(Webhook::factory()->create());

    expect($attempt->status_code)->toBeNull()
        ->and($attempt->error)->toStartWith(UnsafeTarget::PRIVATE_ADDRESS);
    Http::assertNothingSent();
});

it('never sends inside a transaction', function () use ($ping) {
    $levels = [];
    Http::fake(function () use (&$levels) {
        $levels[] = DB::transactionLevel();

        return Http::response('ok');
    });

    $ping(Webhook::factory()->create());

    // the test itself runs in one transaction (RefreshDatabase): the ping adds none around the request
    expect($levels)->toBe([1]);
});

it('lets only accounts with org.manage ping', function () {
    $webhook = Webhook::factory()->create();

    expect(problemOf(fn () => PingWebhook::run(actor(User::factory()->create()), $webhook))->status)->toBe(403);
    Http::assertNothingSent();
    expect(WebhookDelivery::query()->count())->toBe(0);
});

it('answers 503 and not 404 when the log lost the line of the ping', function () use ($ping) {
    Http::fake(['*' => Http::response('ok')]);
    app()->bind(RecordWebhookAttempt::class, fn () => throw new RuntimeException('Deadlock found when trying to get lock'));

    $problem = problemOf(fn () => $ping(Webhook::factory()->create()));

    expect($problem->status)->toBe(503)
        ->and($problem->reason)->toBe('webhook_not_logged')
        ->and(WebhookDelivery::query()->sole()->status)->toBe(WebhookDelivery::FAILED);
    Http::assertSentCount(1);
});
