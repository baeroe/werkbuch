<?php

use App\Actions\GitHub\HandleGitHubDelivery;
use App\Actions\GitHub\PruneGitHubDeliveries;
use App\Domain\GitHub\WebhookSignature;
use App\GitHub\GitHubUnavailable;
use App\Http\Middleware\VerifyGitHubSignature;
use App\Jobs\ProcessGitHubDelivery;
use App\Jobs\PruneGitHubDeliveriesJob;
use App\Models\GitHubApp;
use App\Models\GitHubDelivery;
use App\Models\GitHubRepository;
use App\Models\User;
use App\Support\Actor;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Queue;
use Illuminate\Support\Str;
use Tests\Support\FakeGitHub;

/*
 * The webhook of the app (spec 11.4): `POST /github/webhook` without a middleware group, signed with the secret of the
 * app (401 otherwise), kept once per delivery ID and worked in the queue.
 */

beforeEach(function () {
    $this->github = FakeGitHub::connected();
});

it('verifies the webhook signature and handles a redelivery once', function () {
    Queue::fake([ProcessGitHubDelivery::class]);
    $payload = ['zen' => 'Keep it logically awesome.', 'hook_id' => 501, 'hook' => ['type' => 'App', 'id' => 501, 'events' => ['push']]];

    FakeGitHub::deliver($this, 'ping', $payload, 'd-1')->assertStatus(202)->assertExactJson(['delivery' => 'd-1', 'duplicate' => false]);
    FakeGitHub::deliver($this, 'ping', $payload, 'd-1')->assertStatus(202)->assertExactJson(['delivery' => 'd-1', 'duplicate' => true]);

    expect(GitHubDelivery::query()->sole()->only(['delivery_id', 'event', 'action']))->toBe(['delivery_id' => 'd-1', 'event' => 'ping', 'action' => null]);
    Queue::assertPushedTimes(ProcessGitHubDelivery::class, 1);

    FakeGitHub::deliver($this, 'ping', $payload, 'd-2', 'another secret')->assertUnauthorized()->assertJsonPath('reason', 'unauthenticated');
    FakeGitHub::deliver($this, 'ping', $payload, 'd-3', signature: 'sha256=00')->assertUnauthorized();
    $this->call('POST', '/github/webhook', [], [], [], ['CONTENT_TYPE' => 'application/json', 'HTTP_X_GITHUB_EVENT' => 'ping'], '{}')->assertUnauthorized();
    expect(GitHubDelivery::query()->count())->toBe(1);

    GitHubApp::query()->delete();
    FakeGitHub::deliver($this, 'ping', $payload, 'd-4', 'whatever')->assertUnauthorized();
});

it('refuses a signed delivery without its headers or a JSON object', function () {
    $secret = GitHubApp::query()->sole()->webhook_secret;
    $send = fn (string $body, array $server) => $this->call('POST', '/github/webhook', [], [], [], [
        'CONTENT_TYPE' => 'application/json', 'HTTP_X_HUB_SIGNATURE_256' => WebhookSignature::sign($secret, $body), ...$server,
    ], $body);

    $send('{"a":1}', ['HTTP_X_GITHUB_EVENT' => 'push'])->assertUnprocessable()->assertJsonPath('errors.delivery.0', __('field.delivery.github'));
    $send('{"a":1}', ['HTTP_X_GITHUB_DELIVERY' => 'd'])->assertUnprocessable()->assertJsonPath('errors.event.0', __('field.event.github'));
    $send('[1]', ['HTTP_X_GITHUB_DELIVERY' => 'd', 'HTTP_X_GITHUB_EVENT' => 'push'])->assertUnprocessable()->assertJsonPath('errors.payload.0', __('field.payload.github'));
    $send('nope', ['HTTP_X_GITHUB_DELIVERY' => 'd', 'HTTP_X_GITHUB_EVENT' => 'push'])->assertUnprocessable();
    expect(GitHubDelivery::query()->exists())->toBeFalse();
});

it('reads GitHub again on an installation event and keeps the outcome of every delivery', function () {
    $this->github->repositories[55_000_001][] = FakeGitHub::repositoryJson(700_000_002, 'feldwerk/app');

    FakeGitHub::deliver($this, 'installation_repositories', [
        'action' => 'added', 'installation' => ['id' => 55_000_001, 'account' => ['login' => 'feldwerk']], 'repository_selection' => 'selected',
        'repositories_added' => [['id' => 700_000_002, 'node_id' => 'R_2', 'name' => 'app', 'full_name' => 'feldwerk/app', 'private' => true]],
        'repositories_removed' => [], 'requester' => null, 'sender' => ['login' => 'rafael-feldwerk', 'type' => 'User'],
    ], 'd-inst')->assertStatus(202);

    expect(GitHubRepository::query()->where('full_name', 'feldwerk/app')->exists())->toBeTrue()
        ->and(GitHubDelivery::query()->sole()->only(['action', 'outcome']))->toBe(['action' => 'added', 'outcome' => 'synced']);

    FakeGitHub::deliver($this, 'pull_request', ['action' => 'opened', 'number' => 7, 'pull_request' => ['number' => 7]], 'd-pr')->assertStatus(202);
    FakeGitHub::deliver($this, 'ping', ['zen' => 'Design for failure.'], 'd-ping')->assertStatus(202);
    expect(GitHubDelivery::query()->where('delivery_id', 'd-pr')->value('outcome'))->toBe('ignored')
        ->and(GitHubDelivery::query()->where('delivery_id', 'd-ping')->value('outcome'))->toBe('ok');

    // worked once: the job of a redelivered row does nothing
    expect(HandleGitHubDelivery::run(Actor::system(User::defaultBot(), 'test'), GitHubDelivery::query()->where('delivery_id', 'd-pr')->value('id')))->toBeNull()
        ->and(HandleGitHubDelivery::run(Actor::system(User::defaultBot(), 'test'), '01J00000000000000000000000'))->toBeNull();
});

it('lets the job try a sync again when GitHub does not answer and ignores deliveries without an app', function () {
    Queue::fake([ProcessGitHubDelivery::class]);
    FakeGitHub::deliver($this, 'installation', ['action' => 'deleted', 'installation' => ['id' => 55_000_001]], 'd-gone')->assertStatus(202);
    $id = GitHubDelivery::query()->sole()->id;
    $this->github->refuse = ['/app/installations' => 503];

    expect(fn () => (new ProcessGitHubDelivery($id))->handle())->toThrow(GitHubUnavailable::class)
        ->and(GitHubDelivery::query()->sole()->processed_at)->toBeNull();

    GitHubApp::query()->delete();
    (new ProcessGitHubDelivery($id))->handle();
    expect(GitHubDelivery::query()->sole()->outcome)->toBe('ignored');
    Http::assertNotSent(fn ($request) => str_contains($request->url(), 'installation/repositories'));
});

it('takes a signed delivery larger than the JSON limit of the API, up to the 25 MB of GitHub', function () {
    Queue::fake([ProcessGitHubDelivery::class]);
    // a push with many commits: over the 8 MiB of the API, under the 25 MB GitHub sends at most
    $payload = ['zen' => 'Big', 'filler' => str_repeat('x', 10 * 1024 * 1024)];

    FakeGitHub::deliver($this, 'ping', $payload, 'd-big')->assertStatus(202);
    expect(strlen(GitHubDelivery::query()->sole()->payload))->toBeGreaterThan(10 * 1024 * 1024);

    $this->call('POST', '/github/webhook', [], [], [], ['CONTENT_TYPE' => 'application/json', 'CONTENT_LENGTH' => (string) (VerifyGitHubSignature::MAX_BYTES + 1)], '{}')
        ->assertStatus(413)->assertJsonPath('reason', 'payload_too_large')->assertJsonPath('detail', __('problem.detail.github_too_large'));
});

it('counts only unsigned requests against their address', function () {
    Queue::fake([ProcessGitHubDelivery::class]);
    foreach (range(1, VerifyGitHubSignature::UNSIGNED_PER_MINUTE) as $n) {
        FakeGitHub::deliver($this, 'ping', ['zen' => 'x'], "u-{$n}", 'wrong secret')->assertUnauthorized();
    }
    FakeGitHub::deliver($this, 'ping', ['zen' => 'x'], 'u-last', 'wrong secret')->assertStatus(429)->assertHeader('Retry-After');

    // GitHub itself (signed) is never throttled, not even from the same address
    foreach (range(1, VerifyGitHubSignature::UNSIGNED_PER_MINUTE + 5) as $n) {
        FakeGitHub::deliver($this, 'ping', ['zen' => 'x'], "s-{$n}")->assertStatus(202);
    }

    $this->travel(61)->seconds();
    FakeGitHub::deliver($this, 'ping', ['zen' => 'x'], 'u-again', 'wrong secret')->assertUnauthorized();
});

it('forgets deliveries after 30 days', function () {
    GitHubDelivery::query()->insert([
        ['id' => (string) Str::ulid(), 'delivery_id' => 'old', 'event' => 'ping', 'payload' => '{}', 'received_at' => now()->subDays(31), 'processed_at' => null],
        ['id' => (string) Str::ulid(), 'delivery_id' => 'new', 'event' => 'ping', 'payload' => '{}', 'received_at' => now()->subDays(29), 'processed_at' => now()],
    ]);

    expect(PruneGitHubDeliveries::run(Actor::system(User::defaultBot(), 'test')))->toBe(1)
        ->and(GitHubDelivery::query()->pluck('delivery_id')->all())->toBe(['new']);

    (new PruneGitHubDeliveriesJob)->handle();
    expect((new PruneGitHubDeliveriesJob)->middleware())->toHaveCount(1);
});
