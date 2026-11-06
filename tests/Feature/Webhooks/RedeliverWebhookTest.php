<?php

use App\Access\ProjectRole;
use App\Access\RoleAssignments;
use App\Actions\Webhooks\RecordWebhookAttempt;
use App\Actions\Webhooks\RedeliverWebhook;
use App\Actions\WorkItems\CreateWorkItem;
use App\Events\EventType;
use App\Jobs\DeliverWebhook;
use App\Models\Project;
use App\Models\User;
use App\Models\Webhook;
use App\Models\WebhookAttempt;
use App\Models\WebhookDelivery;
use App\Webhooks\UnsafeTarget;
use Illuminate\Support\Facades\Artisan;
use Illuminate\Support\Facades\DB;
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

it('refuses to redeliver once the bot lost the project', function () use ($redeliver) {
    Http::fake(['*' => Http::response('ok')]);
    $mara = User::factory()->admin()->create();
    $web = Project::factory()->private()->member($mara, ProjectRole::Admin)->create(['lead_id' => $mara->id]);
    $kira = User::factory()->bot($mara)->create();
    app(RoleAssignments::class)->setProjectRole($kira, $web, ProjectRole::Member);
    $item = CreateWorkItem::run(actor($mara), ['project_id' => $web->id, 'title' => 'Formular prüfen']);
    $webhook = Webhook::factory()->forBot($kira)->create(['url' => 'https://receiver.example.com/hook']);
    $delivery = WebhookDelivery::factory()->for($webhook)->create(['event_id' => eventsOf(EventType::WorkItemCreated, $item)->sole()->id, 'status' => WebhookDelivery::FAILED]);
    app(RoleAssignments::class)->removeFromProject($kira, $web);

    $attempt = $redeliver($delivery);

    Http::assertNothingSent();
    expect($attempt->kind)->toBe(WebhookAttempt::MANUAL)
        ->and($attempt->status_code)->toBeNull()
        ->and($attempt->error)->toStartWith(UnsafeTarget::BOT_ACCESS)
        ->and($delivery->fresh()->status)->toBe(WebhookDelivery::FAILED)
        ->and($delivery->fresh()->attempts)->toBe(1);
});

it('keeps the scheduled retries after a failed redelivery', function () use ($redeliver) {
    config(['queue.default' => 'database']);
    Http::fake(['*' => Http::sequence()->push('nope', 502)->push('ok', 200)]);
    $delivery = WebhookDelivery::factory()->for(Webhook::factory()->create())->create(['status' => WebhookDelivery::PENDING]);
    DeliverWebhook::enqueue($delivery);

    $attempt = $redeliver($delivery);

    expect($attempt->status_code)->toBe(502)
        ->and($delivery->fresh()->status)->toBe(WebhookDelivery::PENDING)
        ->and(DB::table('jobs')->where('queue', 'webhooks')->count())->toBe(1);

    Artisan::call('queue:work', ['--once' => true, '--queue' => 'webhooks', '--sleep' => 0]);

    expect($delivery->fresh()->status)->toBe(WebhookDelivery::SUCCEEDED)
        ->and(WebhookAttempt::query()->where('delivery_id', $delivery->id)->orderBy('attempt')->pluck('kind')->all())
        ->toBe([WebhookAttempt::MANUAL, WebhookAttempt::SCHEDULED])
        ->and(DB::table('jobs')->where('queue', 'webhooks')->count())->toBe(0);
});

it('answers with its own attempt when a scheduled try is logged meanwhile', function () use ($redeliver) {
    $delivery = WebhookDelivery::factory()->for(Webhook::factory()->create())->create(['status' => WebhookDelivery::PENDING]);
    Http::fake(function () use ($delivery) {
        // another process: the scheduled try of the same delivery is recorded while "send again" waits for the receiver
        RecordWebhookAttempt::run(actor(User::defaultBot()), $delivery->id, 500, 3, 'late', null, WebhookAttempt::SCHEDULED);

        return Http::response('ok');
    });

    $attempt = $redeliver($delivery);

    expect($attempt->kind)->toBe(WebhookAttempt::MANUAL)
        ->and($attempt->status_code)->toBe(200)
        ->and($attempt->attempt)->toBe(2);
});

it('answers 503 when the log lost the line of the redelivery', function () use ($redeliver) {
    Http::fake(['*' => Http::response('ok')]);
    app()->bind(RecordWebhookAttempt::class, fn () => throw new RuntimeException('Deadlock found when trying to get lock'));
    $delivery = WebhookDelivery::factory()->for(Webhook::factory()->create())->create();

    $problem = problemOf(fn () => $redeliver($delivery));

    expect($problem->status)->toBe(503)
        ->and($problem->reason)->toBe('webhook_not_logged');
});

it('answers 404 and calls nobody for a delivery deleted meanwhile', function () use ($redeliver) {
    Http::fake(['*' => Http::response('ok')]);
    $delivery = WebhookDelivery::factory()->for(Webhook::factory()->create())->create();
    $delivery->webhook; // bound before the row went, as the route binds it
    WebhookDelivery::query()->whereKey($delivery->id)->delete();

    $problem = problemOf(fn () => $redeliver($delivery));

    expect($problem->status)->toBe(404);
    Http::assertNothingSent();
});
