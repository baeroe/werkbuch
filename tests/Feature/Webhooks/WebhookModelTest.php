<?php

use App\Actions\Projects\PurgeProject;
use App\Events\EventType;
use App\Models\Project;
use App\Models\User;
use App\Models\Webhook;
use App\Models\WebhookAttempt;
use App\Models\WebhookDelivery;
use Illuminate\Database\QueryException;
use Illuminate\Database\UniqueConstraintViolationException;
use Illuminate\Support\Facades\Crypt;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use Tests\Feature\Access\MatrixWorld;

// Webhooks, their deliveries and attempts as stored (spec 6.3, 7.4, 7.5, plan "Datenmodell").

it('stores the secret encrypted', function () {
    $secret = Webhook::newSecret();
    $webhook = Webhook::factory()->create(['secret' => $secret]);

    $raw = (string) DB::table('webhooks')->where('id', $webhook->id)->value('secret');

    expect($raw)->not->toBe($secret)
        ->and($raw)->not->toContain($secret)
        ->and(Crypt::decryptString($raw))->toBe($secret)
        ->and($webhook->fresh()?->secret)->toBe($secret);
});

it('never serializes the secret', function () {
    $webhook = Webhook::factory()->create();

    expect($webhook->toArray())->not->toHaveKey('secret')
        ->and($webhook->toJson())->not->toContain($webhook->secret)
        ->and($webhook->fresh()?->toJson())->not->toContain($webhook->secret);
});

it('makes a fresh secret of 32 random bytes each time', function () {
    $secret = Webhook::newSecret();

    expect($secret)->toMatch('/^whsec_[A-Za-z0-9_-]{43}\z/')
        ->and(strlen((string) base64_decode(strtr(substr($secret, 6), '-_', '+/'), true)))->toBe(32)
        ->and(Webhook::newSecret())->not->toBe($secret);
});

it('names the events of the catalog in the order of the enum', function () {
    $catalog = Webhook::catalog();

    expect($catalog)->toBe(array_values(array_map(
        fn (EventType $type) => $type->value,
        array_filter(EventType::cases(), fn (EventType $type) => $type->webhook()),
    )))
        ->and($catalog[0])->toBe('project.created')
        ->and($catalog)->toContain('bot.assigned')
        ->and($catalog)->not->toContain('webhook.created')
        ->and($catalog)->not->toContain('comment.reaction_added');
});

it('matches its patterns', function () {
    $webhook = MatrixWorld::build()->webhook();
    $single = Webhook::factory()->create(['events' => ['comment.created', 'bot.assigned']]);

    expect($webhook->events)->toBe(['work_item.*'])
        ->and($webhook->matches(EventType::WorkItemAssigned))->toBeTrue()
        ->and($webhook->matches(EventType::WorkItemDeleted))->toBeTrue()
        ->and($webhook->matches(EventType::CommentCreated))->toBeFalse()
        // outside the catalog, never, not even by the wildcard of its group
        ->and($webhook->matches(EventType::WorkItemSubscribed))->toBeFalse()
        ->and($single->matches(EventType::CommentCreated))->toBeTrue()
        ->and($single->matches(EventType::BotAssigned))->toBeTrue()
        ->and($single->matches(EventType::CommentUpdated))->toBeFalse();
});

it('takes its deliveries and attempts with it', function () {
    $webhook = Webhook::factory()->create();
    $other = WebhookAttempt::factory()->create();
    $delivery = WebhookDelivery::factory()->for($webhook)->create();
    WebhookAttempt::factory()->for($delivery, 'delivery')->count(2)->sequence(['attempt' => 2], ['attempt' => 1])->create();

    expect($delivery->attempts()->pluck('attempt')->all())->toBe([1, 2])
        ->and($delivery->webhook->is($webhook))->toBeTrue()
        ->and($webhook->deliveries()->count())->toBe(1);

    $webhook->delete();

    expect(WebhookDelivery::query()->pluck('id')->all())->toBe([$other->delivery_id])
        ->and(WebhookAttempt::query()->pluck('id')->all())->toBe([$other->id]);
});

it('keeps one delivery per event and webhook, and any number of pings', function () {
    $webhook = Webhook::factory()->create();
    WebhookDelivery::factory()->for($webhook)->count(2)->create(['event_id' => null, 'event' => 'ping']);
    $event = (string) Str::ulid();
    WebhookDelivery::factory()->for($webhook)->create(['event_id' => $event]);
    WebhookDelivery::factory()->create(['event_id' => $event]);

    expect(WebhookDelivery::query()->count())->toBe(4);

    WebhookDelivery::factory()->for($webhook)->create(['event_id' => $event]);
})->throws(UniqueConstraintViolationException::class);

it('goes with its project', function () {
    $project = Project::factory()->create();
    $organization = Webhook::factory()->create();
    $webhook = Webhook::factory()->forProject($project)->create();
    $attempt = WebhookAttempt::factory()->for(WebhookDelivery::factory()->for($webhook), 'delivery')->create();

    expect($webhook->project?->is($project))->toBeTrue()
        ->and($organization->project)->toBeNull();

    $project->forceFill(['deleting_at' => now()])->save();
    PurgeProject::run(actor(User::defaultBot()), $project);

    expect(Webhook::query()->pluck('id')->all())->toBe([$organization->id])
        ->and(WebhookDelivery::query()->count())->toBe(0)
        ->and(WebhookAttempt::query()->find($attempt->id))->toBeNull();
});

it('keeps a bot from being deleted', function () {
    $bot = User::factory()->bot()->create();
    $webhook = Webhook::factory()->forBot($bot)->create();

    expect($webhook->bot?->is($bot))->toBeTrue()
        ->and($webhook->creator->isPerson())->toBeTrue();

    $bot->delete();
})->throws(QueryException::class);

it('reads its stamps and flags', function () {
    $this->travelTo('2026-11-05 10:00:00.123456');
    $webhook = Webhook::factory()->disabled(now()->subHour())->failingSince(now()->subDay())->create()->fresh();

    expect($webhook?->active)->toBeFalse()
        ->and($webhook?->disabled_at?->toIso8601String())->toBe('2026-11-05T09:00:00+00:00')
        ->and($webhook?->failing_since?->format('Y-m-d H:i:s.u'))->toBe('2026-11-04 10:00:00.123456')
        ->and($webhook?->last_success_at)->toBeNull()
        ->and(Webhook::factory()->create()->fresh()?->active)->toBeTrue();
});

it('keeps the microseconds of deliveries and attempts and says why an attempt got no answer', function () {
    $this->travelTo('2026-11-05 10:00:00.654321');
    $attempt = WebhookAttempt::factory()->noAnswer('timeout')->create()->fresh();
    $answered = WebhookAttempt::factory()->status(503)->create()->fresh();

    expect($attempt?->status_code)->toBeNull()
        ->and($attempt?->error)->toBe('timeout')
        ->and($attempt?->attempted_at->format('Y-m-d H:i:s.u'))->toBe('2026-11-05 10:00:00.654321')
        ->and($attempt?->delivery->created_at?->format('u'))->toBe('654321')
        ->and($attempt?->delivery->status)->toBe(WebhookDelivery::PENDING)
        ->and($answered?->status_code)->toBe(503)
        ->and($answered?->error)->toBeNull()
        ->and($answered?->kind)->toBe(WebhookAttempt::SCHEDULED);
});
