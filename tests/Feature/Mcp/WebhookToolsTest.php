<?php

use App\Access\ProjectRole;
use App\Events\EventType;
use App\Models\Project;
use App\Models\User;
use App\Models\Webhook;
use App\Models\WebhookDelivery;
use Illuminate\Log\Events\MessageLogged;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Event;
use Illuminate\Support\Facades\Http;
use Tests\Support\Mcp\McpClient;

/*
 * The pair `webhooks` / `manage-webhooks` (phase 13, task 10; K16, K17): the webhooks over MCP. That every action
 * answers what its REST twin answers, McpParityTest says (tools.php); this file pins what only MCP meets: the secret
 * only in the answer of create and rotate-secret (never printed here: a failed test would put it in the CI log), the six
 * pings a minute shared with REST and the refusal of a member.
 */

$input = fn (array $overrides = []): array => [
    'name' => 'Agent', 'url' => 'https://receiver.example.com/hook', 'project_id' => null,
    'events' => ['work_item.*'], 'bot_id' => null, 'active' => true, ...$overrides,
];

beforeEach(function () {
    resolver(['receiver.example.com' => ['93.184.216.34']]);
    Http::fake(['*' => Http::response('ok')]);
});

it('shows the secret only in the answer of create and rotate', function () use ($input) {
    $logged = [];
    Event::listen(MessageLogged::class, function (MessageLogged $log) use (&$logged) {
        $logged[] = $log->message.json_encode($log->context);
    });
    $admin = User::factory()->admin()->create();
    $mcp = McpClient::for($this, apiToken($admin, ['read', 'write', 'mcp']));

    $created = $mcp->call('manage-webhooks', ['action' => 'create', 'input' => $input()]);
    $id = $created['structuredContent']['data']['id'];
    $secret = $created['structuredContent']['secret'];
    $rotated = $mcp->call('manage-webhooks', ['action' => 'rotate-secret', 'webhook' => $id]);
    $renewed = $rotated['structuredContent']['secret'];
    $updated = $mcp->call('manage-webhooks', ['action' => 'update', 'webhook' => $id, 'input' => $input(['name' => 'Agent 2'])]);
    $refused = $mcp->call('manage-webhooks', ['action' => 'update', 'webhook' => $id, 'input' => $input(['name' => '', 'secret' => 'whsec_CANARY'])]);
    // a line through the same logger: the listener hears what the app logs (control for the check below)
    logger()->warning('webhook tools test control');

    $show = fn (array $result): string => (string) json_encode($result);
    $get = $mcp->call('webhooks', ['action' => 'get', 'webhook' => $id]);
    $list = $mcp->call('webhooks', ['action' => 'list']);
    $deliveries = $mcp->call('webhooks', ['action' => 'deliveries', 'webhook' => $id]);

    // preg_match, never toMatch: a failing toMatch prints the secret into the log of the run
    $shaped = fn (mixed $value): bool => is_string($value) && preg_match('/^whsec_[A-Za-z0-9_-]{43}\z/', $value) === 1;
    expect($shaped($secret))->toBeTrue('create answered no secret of the form whsec_…')
        ->and($shaped($renewed))->toBeTrue('rotate-secret answered no secret of the form whsec_…')
        ->and($renewed === $secret)->toBeFalse('rotate-secret made no new secret')
        ->and(array_keys($created['structuredContent']))->toBe(['data', 'secret'])
        ->and(array_keys($rotated['structuredContent']))->toBe(['data', 'secret'])
        ->and(array_key_exists('secret', $updated['structuredContent']))->toBeFalse('update answered a secret')
        ->and($updated['structuredContent']['data']['name'])->toBe('Agent 2')
        ->and($refused['isError'])->toBeTrue()
        ->and($refused['structuredContent']['status'])->toBe(422)
        ->and($refused['structuredContent']['errors'])->toBe(['name' => [__('field.name.required')]])
        ->and(array_key_exists('secret', $get['structuredContent']))->toBeFalse('get answered a secret')
        ->and(array_key_exists('secret', $get['structuredContent']['data']))->toBeFalse('get data holds a secret');

    foreach ([$show($updated), $show($refused), $show($get), $show($list), $show($deliveries)] as $text) {
        expect(str_contains($text, 'whsec_'))->toBeFalse('an answer other than create and rotate-secret holds a secret');
    }
    // the events of the three writes are there, their changes and meta hold no secret
    expect(eventsOf(EventType::WebhookCreated)->count())->toBe(1)
        ->and(eventsOf(EventType::WebhookSecretRotated)->count())->toBe(1)
        ->and(eventsOf(EventType::WebhookUpdated)->count())->toBe(1);
    foreach (['changes', 'meta'] as $column) {
        expect(DB::table('events')->where($column, 'like', '%whsec_%')->count())->toBe(0, "events.{$column} holds a secret");
    }
    expect(collect($logged)->contains(fn (string $line) => str_contains($line, 'webhook tools test control')))->toBeTrue('the listener heard nothing')
        ->and(collect($logged)->contains(fn (string $line) => str_contains($line, 'whsec_')))->toBeFalse('the log holds a secret');
});

it('shares the six pings a minute with REST', function () {
    $admin = User::factory()->admin()->create();
    $plain = apiToken($admin, ['read', 'write', 'mcp']);
    $webhook = Webhook::factory()->create();
    $mcp = McpClient::for($this, $plain);

    foreach (range(1, 3) as $_) {
        forgetApiAuth();
        $this->postJson("/api/v1/webhooks/{$webhook->id}/ping", [], ['Authorization' => 'Bearer '.$plain])->assertOk();
    }
    foreach (range(1, 3) as $_) {
        $pinged = $mcp->call('manage-webhooks', ['action' => 'ping', 'webhook' => $webhook->id]);
        expect($pinged['isError'])->toBeFalse((string) json_encode($pinged))
            ->and($pinged['structuredContent']['data']['kind'])->toBe('ping');
    }

    $seventh = $mcp->call('manage-webhooks', ['action' => 'ping', 'webhook' => $webhook->id]);

    expect($seventh['isError'])->toBeTrue()
        ->and($seventh['structuredContent']['status'])->toBe(429)
        ->and($seventh['structuredContent']['reason'])->toBe('too_many_requests')
        ->and($seventh['structuredContent']['retry_after'])->toBeGreaterThan(0)
        // the seventh sent nothing: six deliveries of the event ping
        ->and(WebhookDelivery::query()->where('webhook_id', $webhook->id)->count())->toBe(6);
});

it('counts a redelivery in the same quota', function () {
    $admin = User::factory()->admin()->create();
    $mcp = McpClient::for($this, apiToken($admin, ['read', 'write', 'mcp']));
    $webhook = Webhook::factory()->create();
    $delivery = WebhookDelivery::factory()->for($webhook)->create();

    foreach (range(1, 5) as $_) {
        $mcp->call('manage-webhooks', ['action' => 'ping', 'webhook' => $webhook->id]);
    }
    $again = $mcp->call('manage-webhooks', ['action' => 'redeliver', 'webhook' => $webhook->id, 'delivery' => $delivery->id]);
    $over = $mcp->call('manage-webhooks', ['action' => 'redeliver', 'webhook' => $webhook->id, 'delivery' => $delivery->id]);

    expect($again['isError'])->toBeFalse((string) json_encode($again))
        ->and($again['structuredContent']['data']['kind'])->toBe('manual')
        ->and($over['structuredContent']['status'])->toBe(429);
});

it('refuses a member with 403 and reads nothing', function () use ($input) {
    $web = Project::factory()->identifier('WEB')->create();
    $member = memberOf($web, ProjectRole::Admin);
    $webhook = Webhook::factory()->create();
    $mcp = McpClient::for($this, apiToken($member, ['read', 'write', 'mcp']));

    $created = $mcp->call('manage-webhooks', ['action' => 'create', 'input' => $input()]);
    $listed = $mcp->call('webhooks', ['action' => 'list']);

    foreach ([$created, $listed, $mcp->call('manage-webhooks', ['action' => 'ping', 'webhook' => $webhook->id])] as $refused) {
        expect($refused['isError'])->toBeTrue()
            ->and($refused['structuredContent']['status'])->toBe(403)
            ->and($refused['structuredContent']['detail'])->toBe(__('problem.detail.webhooks_admins_only'));
    }
    expect(Webhook::query()->count())->toBe(1)
        ->and(WebhookDelivery::query()->count())->toBe(0);
});

it('lists the attempts of a webhook and deletes it', function () {
    $admin = User::factory()->admin()->create();
    $mcp = McpClient::for($this, apiToken($admin, ['read', 'write', 'mcp']));
    $webhook = Webhook::factory()->create();
    $mcp->call('manage-webhooks', ['action' => 'ping', 'webhook' => $webhook->id]);

    $deliveries = $mcp->call('webhooks', ['action' => 'deliveries', 'webhook' => $webhook->id]);
    $deleted = $mcp->call('manage-webhooks', ['action' => 'delete', 'webhook' => $webhook->id]);

    expect($deliveries['structuredContent']['data'])->toHaveCount(1)
        ->and($deliveries['structuredContent']['data'][0]['event'])->toBe('ping')
        ->and($deleted['structuredContent'])->toBe(['done' => true])
        ->and(Webhook::query()->whereKey($webhook->id)->exists())->toBeFalse();
});
