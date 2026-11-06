<?php

use App\Actions\Webhooks\DisableWebhook;
use App\Actions\Webhooks\RecordWebhookAttempt;
use App\Events\EventType;
use App\Models\Project;
use App\Models\User;
use App\Models\Webhook;
use App\Models\WebhookAttempt;
use App\Models\WebhookDelivery;
use App\Support\Actor;
use Illuminate\Support\Facades\DB;

/*
 * The log of an attempt and the switch that turns a failing webhook off (task 7, A366, K6): only a failed scheduled
 * try counts, 24 hours after the first failure since the last success; a success of any kind starts the clock anew.
 * The clock is set, the attempts are logged through RecordWebhookAttempt as the job logs them.
 */

beforeEach(fn () => $this->travelTo('2026-11-05 12:00:00.000000'));

$system = fn (): Actor => Actor::system(User::defaultBot(), 'webhooks');

$record = fn (WebhookDelivery $delivery, ?int $status, string $kind = WebhookAttempt::SCHEDULED, bool $final = false, ?string $error = null) => RecordWebhookAttempt::run(
    $system(), $delivery->id, $status, 120, $status === null ? null : 'answer', $status === null ? ($error ?? 'connection: refused') : null, $kind, $final,
);

it('logs an attempt and counts it on the delivery', function () use ($record) {
    $delivery = WebhookDelivery::factory()->create();

    $attempt = $record($delivery, 500);
    $second = $record($delivery, null);

    expect($attempt->only(['delivery_id', 'webhook_id', 'attempt', 'kind', 'status_code', 'duration_ms', 'response_excerpt', 'error']))->toBe([
        'delivery_id' => $delivery->id, 'webhook_id' => $delivery->webhook_id, 'attempt' => 1, 'kind' => WebhookAttempt::SCHEDULED,
        'status_code' => 500, 'duration_ms' => 120, 'response_excerpt' => 'answer', 'error' => null,
    ])
        ->and($attempt->attempted_at->format('Y-m-d H:i:s.u'))->toBe('2026-11-05 12:00:00.000000')
        ->and($second->only(['attempt', 'status_code', 'response_excerpt', 'error']))->toBe(['attempt' => 2, 'status_code' => null, 'response_excerpt' => null, 'error' => 'connection: refused'])
        ->and($delivery->fresh()->only(['status', 'attempts']))->toBe(['status' => WebhookDelivery::PENDING, 'attempts' => 2]);
});

it('cuts an answer and an error to what the log keeps', function () use ($system) {
    $delivery = WebhookDelivery::factory()->create();

    $answered = RecordWebhookAttempt::run($system(), $delivery->id, 500, 1, str_repeat('ä', 2000), null, WebhookAttempt::SCHEDULED);
    $failed = RecordWebhookAttempt::run($system(), $delivery->id, null, 1, null, 'connection: '.str_repeat('x', 400), WebhookAttempt::SCHEDULED);

    expect(strlen((string) $answered->response_excerpt))->toBe(2048)
        ->and(mb_strlen((string) $failed->error))->toBe(300);
});

it('has nothing to log for a delivery that is gone', function () use ($record) {
    $delivery = WebhookDelivery::factory()->create();
    Webhook::query()->whereKey($delivery->webhook_id)->delete();

    expect($record($delivery, 200))->toBeNull()
        ->and(WebhookAttempt::query()->count())->toBe(0);
});

it('marks a scheduled delivery succeeded, and failed only at the last try', function () use ($record) {
    $ok = WebhookDelivery::factory()->create();
    $failing = WebhookDelivery::factory()->create();

    $record($ok, 204);
    $record($failing, 500);
    expect($ok->fresh()->status)->toBe(WebhookDelivery::SUCCEEDED)
        ->and($failing->fresh()->status)->toBe(WebhookDelivery::PENDING);

    $record($failing, 500, final: true);
    expect($failing->fresh()->status)->toBe(WebhookDelivery::FAILED);
});

it('counts 3xx and 1xx as failures', function () use ($record) {
    $delivery = WebhookDelivery::factory()->create();

    $record($delivery, 302, final: true);

    expect($delivery->fresh()->status)->toBe(WebhookDelivery::FAILED)
        ->and(Webhook::query()->sole()->failing_since)->not->toBeNull();
});

it('leaves the status of a delivery as it was after a failed manual try or ping, a success finishes it (K6)', function () use ($record) {
    $pending = WebhookDelivery::factory()->create();
    $failed = WebhookDelivery::factory()->create(['status' => WebhookDelivery::FAILED]);

    $record($pending, 500, WebhookAttempt::MANUAL, final: true);
    $record($failed, null, WebhookAttempt::PING, final: true);
    expect($pending->fresh()->status)->toBe(WebhookDelivery::PENDING)
        ->and($failed->fresh()->status)->toBe(WebhookDelivery::FAILED);

    $record($failed, 200, WebhookAttempt::MANUAL, final: true);
    expect($failed->fresh()->only(['status', 'attempts']))->toBe(['status' => WebhookDelivery::SUCCEEDED, 'attempts' => 2]);
});

it('keeps a webhook on after 23 h 59 min of failures', function () use ($record) {
    $webhook = Webhook::factory()->failingSince(now()->subHours(23)->subMinutes(59))->create();
    $delivery = WebhookDelivery::factory()->for($webhook)->create();

    $record($delivery, 500);

    expect($webhook->fresh()->only(['active', 'disabled_at']))->toBe(['active' => true, 'disabled_at' => null])
        ->and(eventsOf(EventType::WebhookDisabled))->toHaveCount(0);
});

it('switches it off at the first failure after 24 hours', function () use ($record) {
    $project = Project::factory()->create();
    $webhook = Webhook::factory()->forProject($project)->failingSince(now()->subDay())->create();
    $delivery = WebhookDelivery::factory()->for($webhook)->create();
    $other = WebhookDelivery::factory()->for($webhook)->create();
    $done = WebhookDelivery::factory()->for($webhook)->create(['status' => WebhookDelivery::SUCCEEDED]);
    $elsewhere = WebhookDelivery::factory()->create();

    $record($delivery, 500);

    $event = eventsOf(EventType::WebhookDisabled, $webhook)->sole();
    $fresh = $webhook->fresh();
    expect($fresh->active)->toBeFalse()
        ->and($fresh->disabled_at?->format('Y-m-d H:i:s'))->toBe('2026-11-05 12:00:00')
        // the clock stays where it was: switching it on again clears it (A366)
        ->and($fresh->failing_since?->format('Y-m-d H:i:s'))->toBe('2026-11-04 12:00:00')
        ->and($event->changes)->toBe(['active' => ['old' => true, 'new' => false]])
        ->and($event->project_id)->toBe($project->id)
        ->and($event->actor_id)->toBe(User::defaultBot()->id)
        ->and($event->meta)->not->toHaveKey('secret')
        ->and($delivery->fresh()->status)->toBe(WebhookDelivery::CANCELLED)
        ->and($other->fresh()->status)->toBe(WebhookDelivery::CANCELLED)
        ->and($done->fresh()->status)->toBe(WebhookDelivery::SUCCEEDED)
        ->and($elsewhere->fresh()->status)->toBe(WebhookDelivery::PENDING);

    // the next failure of a try already under way changes nothing
    $record($other, null);
    expect(eventsOf(EventType::WebhookDisabled))->toHaveCount(1)
        ->and($other->fresh()->status)->toBe(WebhookDelivery::CANCELLED);
});

it('switches an organization webhook off without a project', function () use ($record) {
    $webhook = Webhook::factory()->failingSince(now()->subDays(2))->create();

    $record(WebhookDelivery::factory()->for($webhook)->create(), 500, final: true);

    expect(eventsOf(EventType::WebhookDisabled, $webhook)->sole()->project_id)->toBeNull();
});

it('starts the clock at the first failure and anew after a success', function () use ($record) {
    $webhook = Webhook::factory()->failingSince(now()->subDays(2))->create();
    $delivery = WebhookDelivery::factory()->for($webhook)->create();

    $record($delivery, 200);
    expect($webhook->fresh()->failing_since)->toBeNull()
        ->and($webhook->fresh()->last_success_at?->format('Y-m-d H:i:s'))->toBe('2026-11-05 12:00:00');

    $this->travel(5)->minutes();
    $record(WebhookDelivery::factory()->for($webhook)->create(), 500);
    $this->travel(23)->hours();
    $record(WebhookDelivery::factory()->for($webhook)->create(), 500);

    expect($webhook->fresh()->failing_since?->format('Y-m-d H:i:s'))->toBe('2026-11-05 12:05:00')
        ->and($webhook->fresh()->active)->toBeTrue();
});

it('never switches off on a failed ping or a failed manual try, and starts no clock with them', function () use ($record) {
    $failing = Webhook::factory()->failingSince(now()->subDays(2))->create();
    $fine = Webhook::factory()->create();

    $record(WebhookDelivery::factory()->for($failing)->create(), null, WebhookAttempt::PING, final: true);
    $record(WebhookDelivery::factory()->for($failing)->create(), 500, WebhookAttempt::MANUAL, final: true);
    $record(WebhookDelivery::factory()->for($fine)->create(), 500, WebhookAttempt::PING, final: true);

    expect($failing->fresh()->only(['active', 'disabled_at']))->toBe(['active' => true, 'disabled_at' => null])
        ->and($failing->fresh()->failing_since?->format('Y-m-d H:i:s'))->toBe('2026-11-03 12:00:00')
        ->and($fine->fresh()->failing_since)->toBeNull()
        ->and(eventsOf(EventType::WebhookDisabled))->toHaveCount(0);
});

it('clears the clock on a successful ping', function () use ($record) {
    $webhook = Webhook::factory()->failingSince(now()->subHours(3))->create();

    $record(WebhookDelivery::factory()->for($webhook)->create(), 200, WebhookAttempt::PING, final: true);

    expect($webhook->fresh()->failing_since)->toBeNull();
});

it('leaves the moment the webhook was last changed alone', function () use ($record) {
    $webhook = Webhook::factory()->create(['updated_at' => '2026-11-01 08:00:00']);

    $record(WebhookDelivery::factory()->for($webhook)->create(), 200);
    $record(WebhookDelivery::factory()->for($webhook)->create(), 500);

    expect($webhook->fresh()->updated_at?->format('Y-m-d H:i:s'))->toBe('2026-11-01 08:00:00');
});

it('switches off only a webhook that is still on', function () use ($system) {
    $webhook = Webhook::factory()->create(['active' => false]);
    $pending = WebhookDelivery::factory()->for($webhook)->create();

    DB::transaction(fn () => DisableWebhook::run($system(), Webhook::query()->lockForUpdate()->findOrFail($webhook->id)));

    expect($webhook->fresh()->disabled_at)->toBeNull()
        ->and($pending->fresh()->status)->toBe(WebhookDelivery::PENDING)
        ->and(eventsOf(EventType::WebhookDisabled))->toHaveCount(0);
});

it('leaves a cancelled delivery cancelled when its last scheduled try fails (T7-M2)', function () use ($record) {
    $delivery = WebhookDelivery::factory()->create(['status' => WebhookDelivery::CANCELLED]);

    $record($delivery, 500, final: true);

    expect($delivery->fresh()->only(['status', 'attempts']))->toBe(['status' => WebhookDelivery::CANCELLED, 'attempts' => 1]);
});

it('lets a success stand when a scheduled try already under way fails afterwards (T8-M2)', function () use ($record) {
    $webhook = Webhook::factory()->failingSince(now()->subHours(23))->create();
    $delivery = WebhookDelivery::factory()->for($webhook)->create();

    // "send again" answers while the last scheduled try still waits for the receiver
    $record($delivery, 200, WebhookAttempt::MANUAL);
    $this->travel(2)->hours();
    $record($delivery, 500, final: true);

    $fresh = $webhook->fresh();
    expect($delivery->fresh()->only(['status', 'attempts']))->toBe(['status' => WebhookDelivery::SUCCEEDED, 'attempts' => 2])
        ->and($fresh->failing_since)->toBeNull()
        ->and($fresh->active)->toBeTrue()
        ->and(eventsOf(EventType::WebhookDisabled))->toHaveCount(0);
});

it('counts a late failure of a finished delivery neither for the clock nor for switching off (T8-M2)', function () use ($record) {
    $webhook = Webhook::factory()->failingSince(now()->subDays(2))->create();
    $done = WebhookDelivery::factory()->for($webhook)->create(['status' => WebhookDelivery::SUCCEEDED]);
    $calm = Webhook::factory()->create();
    $finished = WebhookDelivery::factory()->for($calm)->create(['status' => WebhookDelivery::FAILED]);

    $record($done, 500);
    $record($finished, null);

    expect($done->fresh()->status)->toBe(WebhookDelivery::SUCCEEDED)
        ->and($webhook->fresh()->active)->toBeTrue()
        ->and($finished->fresh()->status)->toBe(WebhookDelivery::FAILED)
        ->and($calm->fresh()->failing_since)->toBeNull()
        ->and(eventsOf(EventType::WebhookDisabled))->toHaveCount(0);
});

it('finishes a failed delivery when "send again" succeeds afterwards', function () use ($record) {
    $webhook = Webhook::factory()->failingSince(now()->subHours(2))->create();
    $delivery = WebhookDelivery::factory()->for($webhook)->create();

    $record($delivery, 500, final: true);
    $record($delivery, 200, WebhookAttempt::MANUAL);

    expect($delivery->fresh()->status)->toBe(WebhookDelivery::SUCCEEDED)
        ->and($webhook->fresh()->failing_since)->toBeNull();
});
