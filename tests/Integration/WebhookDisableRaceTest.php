<?php

use App\Actions\Webhooks\RecordWebhookAttempt;
use App\Events\EventType;
use App\Models\User;
use App\Models\Webhook;
use App\Models\WebhookAttempt;
use App\Models\WebhookDelivery;
use App\Support\Actor;
use Tests\Support\RaceConnections;

/*
 * Two tries of two deliveries of one webhook fail at the same time, 24 hours after the first failure (task 7, Review
 * Focus "Abschalten an der Grenze"): `mariadb` logs the first one and switches the webhook off, `mariadb_second` logs
 * the second and waits for the lock on the webhook. One `webhook.disabled`, never two.
 */

beforeEach(fn () => RaceConnections::setUp());

afterEach(fn () => RaceConnections::tearDown());

$fail = fn (WebhookDelivery $delivery) => fn () => RecordWebhookAttempt::run(
    Actor::system(User::defaultBot(), 'webhooks'), $delivery->id, 500, 80, 'down', null, WebhookAttempt::SCHEDULED, false,
);

it('switches the webhook off once when two tries fail at the same time', function () use ($fail) {
    $webhook = Webhook::factory()->failingSince(now()->subDay()->subMinute())->create();
    [$first, $second] = WebhookDelivery::factory()->for($webhook)->count(2)->create()->all();

    RaceConnections::hold($fail($first));

    // the second waits for the first at the lock of the webhook ...
    RaceConnections::expectLockWait(RaceConnections::second($fail($second)), 'webhooks');

    // ... and finds it switched off once the first committed: it logs its attempt, nothing more
    RaceConnections::releaseBeforeLock('webhooks');
    $logged = RaceConnections::second($fail($second));

    expect($logged)->toBeInstanceOf(WebhookAttempt::class)
        ->and(eventsOf(EventType::WebhookDisabled))->toHaveCount(1)
        ->and($webhook->fresh()->active)->toBeFalse()
        ->and(WebhookDelivery::query()->pluck('status')->unique()->all())->toBe([WebhookDelivery::CANCELLED])
        ->and(WebhookAttempt::query()->count())->toBe(2);
});
