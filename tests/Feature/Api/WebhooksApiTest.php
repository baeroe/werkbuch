<?php

use App\Events\EventType;
use App\Models\User;
use App\Models\Webhook;
use App\Models\WebhookAttempt;
use App\Models\WebhookDelivery;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Http;

// The webhooks over REST (plan "REST"): org admins and the default bot over a token; the secret is in the answers of
// creating and of `rotate-secret` only, never in a list, a webhook or a replacement.

/** The shape of `Webhook` (plan "REST"; never `secret`). */
const WEBHOOK_SHAPE = ['id', 'name', 'url', 'project_id', 'events', 'bot_id', 'active', 'disabled_at', 'failing_since',
    'last_success_at', 'created_by', 'created_at', 'updated_at'];

$input = fn (array $overrides = []): array => [
    'name' => 'Agent',
    'url' => 'https://receiver.example.com/hook',
    'project_id' => null,
    'events' => ['work_item.*'],
    'bot_id' => null,
    'active' => true,
    ...$overrides,
];

it('creates, shows, lists, replaces, renews and deletes a webhook', function () use ($input) {
    $admin = User::factory()->admin()->create();
    $this->actingAs($admin);

    $created = $this->postJson('/api/v1/webhooks', $input())->assertCreated();
    expect(array_keys($created->json()))->toBe(['data', 'secret'])
        ->and(array_keys($created->json('data')))->toBe(WEBHOOK_SHAPE)
        ->and($created->json('secret'))->toMatch('/^whsec_[A-Za-z0-9_-]{43}\z/')
        ->and($created->json('data'))->toMatchArray([
            'name' => 'Agent', 'url' => 'https://receiver.example.com/hook', 'project_id' => null, 'events' => ['work_item.*'],
            'bot_id' => null, 'active' => true, 'disabled_at' => null, 'failing_since' => null, 'last_success_at' => null,
            'created_by' => $admin->id,
        ]);
    $id = $created->json('data.id');
    $secret = $created->json('secret');

    $shown = $this->getJson('/api/v1/webhooks/'.strtoupper($id))->assertOk()->assertJsonPath('data', $created->json('data'));
    expect($shown->json())->not->toHaveKey('secret');
    $this->getJson('/api/v1/webhooks')->assertOk()->assertJsonPath('meta.total', 1)->assertJsonPath('data.0.id', $id);

    $replaced = $this->putJson("/api/v1/webhooks/{$id}", $input(['name' => 'Agent 2']))->assertOk()->assertJsonPath('data.name', 'Agent 2');
    expect($replaced->json())->not->toHaveKey('secret');

    $renewed = $this->postJson("/api/v1/webhooks/{$id}/rotate-secret")->assertOk()->assertJsonPath('data.id', $id);
    expect(array_keys($renewed->json()))->toBe(['data', 'secret'])
        ->and($renewed->json('secret'))->not->toBe($secret)
        ->and(Webhook::query()->sole()->secret)->toBe($renewed->json('secret'));

    $this->deleteJson("/api/v1/webhooks/{$id}")->assertNoContent();
    $this->getJson("/api/v1/webhooks/{$id}")->assertNotFound();

    expect(Webhook::query()->count())->toBe(0)
        ->and(DB::table('events')->where('changes', 'like', '%whsec_%')->orWhere('meta', 'like', '%whsec_%')->count())->toBe(0);
});

it('takes its own answer back as a replacement that changes nothing', function () use ($input) {
    $this->actingAs(User::factory()->admin()->create());
    $data = $this->postJson('/api/v1/webhooks', $input())->assertCreated()->json('data');

    $this->travel(1)->minutes();
    $this->putJson("/api/v1/webhooks/{$data['id']}", $data)->assertOk()->assertJsonPath('data', $data);

    expect(eventsOf(EventType::WebhookUpdated))->toHaveCount(0);
});

it('lets a read token read the list and never gives it the secret', function () {
    $admin = User::factory()->admin()->create();
    $webhook = Webhook::factory()->create();

    $list = $this->withToken(apiToken($admin, ['read']))->getJson('/api/v1/webhooks')->assertOk()->assertJsonPath('data.0.id', $webhook->id);
    $shown = $this->withToken(apiToken($admin, ['read']))->getJson("/api/v1/webhooks/{$webhook->id}")->assertOk();

    expect($list->getContent())->not->toContain($webhook->secret)->not->toContain('"secret"')
        ->and($shown->getContent())->not->toContain($webhook->secret)->not->toContain('"secret"');

    forgetApiAuth();
    $this->withToken(apiToken($admin, ['read']))->postJson('/api/v1/webhooks/'.$webhook->id.'/rotate-secret')->assertForbidden();
    expect($webhook->fresh()?->secret)->toBe($webhook->secret);
});

it('creates a webhook with a write token and answers 201 with the secret', function () use ($input) {
    $response = $this->withToken(apiToken(User::defaultBot(), ['write']))->postJson('/api/v1/webhooks', $input())->assertCreated();

    expect($response->json('secret'))->toBe(Webhook::query()->sole()->secret)
        ->and($response->json('data.created_by'))->toBe(User::defaultBot()->id);
});

it('refuses members with 403 and the sentence', function (string $method, string $path) use ($input) {
    $webhook = Webhook::factory()->create();

    $this->actingAs(User::factory()->create())
        ->json($method, str_replace('{id}', $webhook->id, $path), $input())
        ->assertForbidden()
        ->assertJsonPath('detail', __('problem.detail.webhooks_admins_only'));

    expect(Webhook::query()->sole()->name)->toBe($webhook->name);
})->with([
    'list' => ['GET', '/api/v1/webhooks'],
    'create' => ['POST', '/api/v1/webhooks'],
    'show' => ['GET', '/api/v1/webhooks/{id}'],
    'replace' => ['PUT', '/api/v1/webhooks/{id}'],
    'delete' => ['DELETE', '/api/v1/webhooks/{id}'],
    'renew the secret' => ['POST', '/api/v1/webhooks/{id}/rotate-secret'],
]);

it('answers 404 for an unknown webhook or one that is no ULID', function (string $id) {
    $this->actingAs(User::factory()->admin()->create());

    $this->getJson("/api/v1/webhooks/{$id}")->assertNotFound();
    $this->postJson("/api/v1/webhooks/{$id}/rotate-secret")->assertNotFound();
    $this->deleteJson("/api/v1/webhooks/{$id}")->assertNotFound();
})->with(['unknown' => ['01jbz7m0000000000000000000'], 'no ULID' => ['agent']]);

it('answers the fields of an invalid webhook as 422', function () use ($input) {
    $this->actingAs(User::factory()->admin()->create())
        ->postJson('/api/v1/webhooks', $input(['name' => '', 'url' => 'http://127.0.0.1/hook', 'events' => ['nope']]))
        ->assertUnprocessable()
        ->assertJsonPath('errors.name.0', __('field.name.required'))
        ->assertJsonPath('errors.url.0', __('field.url.private'))
        ->assertJsonPath('errors.events.0', __('field.events.unknown', ['name' => 'nope']));

    expect(Webhook::query()->count())->toBe(0);
});

it('asks the database as often for a list of 5 as for 50', function () {
    $admin = User::factory()->admin()->create();
    $count = function () use ($admin): int {
        DB::flushQueryLog();
        DB::enableQueryLog();
        $this->actingAs($admin)->getJson('/api/v1/webhooks?per_page=100')->assertOk();
        DB::disableQueryLog();

        return count(DB::getQueryLog());
    };

    // made by the admin: a new org admin per webhook would make the role index forget the account in between
    Webhook::factory()->count(5)->create(['created_by' => $admin->id]);
    $count();
    $five = $count();
    Webhook::factory()->count(45)->create(['created_by' => $admin->id]);

    expect($count())->toBe($five);
});

/** The shape of an attempt as `WebhookDelivery` (plan "REST"). */
const ATTEMPT_SHAPE = ['id', 'delivery_id', 'webhook_id', 'event', 'attempt', 'kind', 'status_code', 'duration_ms',
    'response_excerpt', 'error', 'created_at'];

it('pings a webhook and answers the attempt', function () {
    resolver(['receiver.example.com' => ['93.184.216.34']]);
    Http::fake(['*' => Http::response('pong')]);
    $webhook = Webhook::factory()->create();
    $this->actingAs(User::factory()->admin()->create());

    $response = $this->postJson("/api/v1/webhooks/{$webhook->id}/ping")->assertOk();

    expect(array_keys($response->json('data')))->toBe(ATTEMPT_SHAPE)
        ->and($response->json('data'))->toMatchArray(['event' => 'ping', 'kind' => 'ping', 'attempt' => 1, 'status_code' => 200, 'response_excerpt' => 'pong', 'webhook_id' => $webhook->id])
        ->and($response->json('data.delivery_id'))->toBe(WebhookDelivery::query()->sole()->id);
});

it('lists the attempts of a webhook, the newest first, with the event of the delivery', function () {
    $webhook = Webhook::factory()->create();
    $delivery = WebhookDelivery::factory()->for($webhook)->create(['event' => 'work_item.created']);
    $old = WebhookAttempt::factory()->for($delivery, 'delivery')->create(['attempted_at' => '2026-11-05 10:00:00.000000']);
    $new = WebhookAttempt::factory()->for($delivery, 'delivery')->create(['attempt' => 2, 'attempted_at' => '2026-11-05 10:00:00.500000']);
    $this->actingAs(User::factory()->admin()->create());

    $response = $this->getJson("/api/v1/webhooks/{$webhook->id}/deliveries")->assertOk()->assertJsonPath('meta.total', 2);

    expect(array_keys($response->json('data.0')))->toBe(ATTEMPT_SHAPE)
        ->and(array_column($response->json('data'), 'id'))->toBe([$new->id, $old->id])
        ->and($response->json('data.0.event'))->toBe('work_item.created')
        ->and($response->json('data.0.created_at'))->toBe($new->fresh()->attempted_at->toJSON())
        ->and($response->json('meta.next_cursor'))->toBeNull();
});

it('sends a delivery again, to any ULID case, and 404s a delivery of another webhook', function () {
    resolver(['receiver.example.com' => ['93.184.216.34']]);
    Http::fake(['*' => Http::response('ok')]);
    $webhook = Webhook::factory()->create();
    $delivery = WebhookDelivery::factory()->for($webhook)->create();
    $other = WebhookDelivery::factory()->create();
    $this->actingAs(User::factory()->admin()->create());

    $this->postJson("/api/v1/webhooks/{$webhook->id}/deliveries/".strtoupper($delivery->id).'/redeliver')
        ->assertOk()->assertJsonPath('data.kind', 'manual')->assertJsonPath('data.delivery_id', $delivery->id);
    $this->postJson("/api/v1/webhooks/{$webhook->id}/deliveries/{$other->id}/redeliver")->assertNotFound();
    $this->postJson("/api/v1/webhooks/{$webhook->id}/deliveries/not-a-ulid/redeliver")->assertNotFound();
    Http::assertSentCount(1);
});

it('lets a read token read the log but neither ping nor send again', function () {
    $admin = User::factory()->admin()->create();
    $webhook = Webhook::factory()->create();
    $delivery = WebhookDelivery::factory()->for($webhook)->create();

    $this->withToken(apiToken($admin, ['read']))->getJson("/api/v1/webhooks/{$webhook->id}/deliveries")->assertOk();
    forgetApiAuth();
    $this->withToken(apiToken($admin, ['read']))->postJson("/api/v1/webhooks/{$webhook->id}/ping")->assertForbidden();
    forgetApiAuth();
    $this->withToken(apiToken($admin, ['read']))->postJson("/api/v1/webhooks/{$webhook->id}/deliveries/{$delivery->id}/redeliver")->assertForbidden();
});

it('throttles the seventh send of a minute per account, ping and redelivery together', function () {
    resolver(['receiver.example.com' => ['93.184.216.34']]);
    Http::fake(['*' => Http::response('ok')]);
    $webhook = Webhook::factory()->create();
    $delivery = WebhookDelivery::factory()->for($webhook)->create();
    $this->actingAs(User::factory()->admin()->create());

    foreach (range(1, 3) as $ignored) {
        $this->postJson("/api/v1/webhooks/{$webhook->id}/ping")->assertOk();
        $this->postJson("/api/v1/webhooks/{$webhook->id}/deliveries/{$delivery->id}/redeliver")->assertOk();
    }

    $this->postJson("/api/v1/webhooks/{$webhook->id}/ping")->assertStatus(429)->assertJsonPath('reason', 'too_many_requests');
    Http::assertSentCount(6);
});

it('refuses members the log, the ping and sending again with 403', function () {
    $webhook = Webhook::factory()->create();
    $delivery = WebhookDelivery::factory()->for($webhook)->create();
    $this->actingAs(User::factory()->create());

    $this->getJson("/api/v1/webhooks/{$webhook->id}/deliveries")->assertForbidden();
    $this->postJson("/api/v1/webhooks/{$webhook->id}/ping")->assertForbidden();
    $this->postJson("/api/v1/webhooks/{$webhook->id}/deliveries/{$delivery->id}/redeliver")->assertForbidden();
});
