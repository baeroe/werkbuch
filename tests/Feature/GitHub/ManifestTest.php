<?php

use App\Actions\GitHub\CompleteManifest;
use App\Actions\GitHub\StartManifest;
use App\Events\EventType;
use App\Exceptions\Problem;
use App\GitHub\Manifest;
use App\Models\GitHubApp;
use App\Models\Organization;
use App\Models\User;
use App\Support\Actor;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Http;
use Illuminate\Validation\ValidationException;
use Tests\Support\FakeGitHub;

/*
 * The manifest flow of the one app (spec 10.2, 11.3, WEBU-24) against a false GitHub: the browser posts the manifest,
 * GitHub sends the person back with a code and the state, the code becomes the app (key and secret encrypted, never in
 * an answer, event or log).
 */

$start = function (User $admin, array $input = []): array {
    return StartManifest::run(Actor::system($admin, 'test'), $input);
};

it('starts the manifest flow with the permissions and events of spec 11.3', function () use ($start) {
    Organization::current()->update(['name' => 'Feldwerk']);
    $started = $start(User::factory()->admin()->create());

    expect($started['url'])->toBe('https://github.com/settings/apps/new?state='.$started['state'])
        ->and($started['manifest'])->toMatchArray([
            'name' => 'Feldwerk werkbuch',
            'url' => config('app.url'),
            'hook_attributes' => ['url' => config('app.url').'/github/webhook', 'active' => true],
            'redirect_url' => config('app.url').'/github/manifest',
            'setup_url' => config('app.url').'/github/setup',
            'setup_on_update' => true,
            'public' => false,
            'default_permissions' => ['contents' => 'write', 'pull_requests' => 'write', 'checks' => 'read', 'actions' => 'read', 'statuses' => 'read', 'metadata' => 'read'],
            'default_events' => ['pull_request', 'push', 'check_suite', 'check_run'],
        ]);
});

it('registers the app under a GitHub organization and keeps the name within 34 characters', function () use ($start) {
    Organization::current()->update(['name' => 'Eine sehr lange Organisation mit Namen']);
    $started = $start(User::factory()->admin()->create(), ['organization' => ' feldwerk-gmbh ']);

    expect($started['url'])->toStartWith('https://github.com/organizations/feldwerk-gmbh/settings/apps/new?state=')
        ->and(mb_strlen($started['manifest']['name']))->toBeLessThanOrEqual(Manifest::NAME_MAX)
        ->and($started['manifest']['name'])->toEndWith(' werkbuch')
        ->and($start(User::factory()->admin()->create(), ['organization' => ''])['url'])->toStartWith('https://github.com/settings/apps/new');
});

it('refuses a login that is no GitHub login, members, and an instance with an app', function () use ($start) {
    $admin = User::factory()->admin()->create();

    expect(fn () => $start($admin, ['organization' => 'feld--werk']))->toThrow(fn (ValidationException $e) => expect($e->errors())->toBe(['organization' => [__('field.organization.github_login')]]))
        ->and(fn () => $start($admin, ['organization' => ['x']]))->toThrow(ValidationException::class)
        ->and(fn () => $start(User::factory()->create()))->toThrow(fn (Problem $e) => expect($e->getStatusCode())->toBe(403));

    GitHubApp::factory()->create();
    expect(fn () => $start($admin))->toThrow(fn (Problem $e) => expect($e->reason)->toBe('github_connected'));
});

it('turns the code into the app once, with the key and the secret encrypted and in no event', function () use ($start) {
    $fake = (new FakeGitHub)->fake();
    $admin = User::factory()->admin()->create();
    $state = $start($admin)['state'];

    $app = CompleteManifest::run(Actor::system($admin, 'test'), ['code' => 'a1b2c3d4e5', 'state' => $state]);
    $raw = DB::table('github_apps')->sole();

    expect([$app->app_id, $app->slug, $app->name, $app->owner_login, $app->owner_type, $app->client_id, $app->created_by])
        ->toBe([4_200_123, 'feldwerk-werkbuch', 'Feldwerk werkbuch', 'feldwerk', 'Organization', 'Iv23liFake', $admin->id])
        ->and($app->private_key)->toBe($fake->conversionPem)
        ->and($raw->private_key)->not->toContain('PRIVATE KEY')
        ->and($raw->webhook_secret)->not->toContain('whsec')
        ->and($app->webhook_secret)->toStartWith('whsec-fake-')
        ->and($app->toArray())->not->toHaveKeys(['private_key', 'webhook_secret'])
        ->and($app->events)->toBe(['check_run', 'check_suite', 'pull_request', 'push']);

    $event = eventsOf(EventType::GitHubConnected)->sole();
    expect($event->changes)->toBe(['app' => ['old' => null, 'new' => 'feldwerk-werkbuch']])
        ->and($event->meta)->toMatchArray(['app_id' => 4_200_123, 'owner' => 'feldwerk'])
        ->and(json_encode([$event->changes, $event->meta]))->not->toContain('PRIVATE KEY')->not->toContain('whsec')->not->toContain('client-secret');

    Http::assertSent(fn ($request) => $request->url() === 'https://api.github.com/app-manifests/a1b2c3d4e5/conversions' && $request->method() === 'POST');

    // the state was taken: the same way back is no good a second time
    expect(fn () => CompleteManifest::run(Actor::system($admin, 'test'), ['code' => 'a1b2c3d4e5', 'state' => $state]))
        ->toThrow(fn (Problem $e) => expect($e->getStatusCode())->toBe(403));
});

it('refuses a state of another person, a broken code and a second app', function () use ($start) {
    (new FakeGitHub)->fake();
    $admin = User::factory()->admin()->create();
    $other = User::factory()->admin()->create();
    $state = $start($admin)['state'];

    expect(fn () => CompleteManifest::run(Actor::system($other, 'test'), ['code' => 'abc', 'state' => $state]))->toThrow(fn (Problem $e) => expect($e->detail)->toBe(__('problem.detail.github_state')))
        ->and(fn () => CompleteManifest::run(Actor::system($admin, 'test'), ['code' => '../x', 'state' => $state]))->toThrow(fn (ValidationException $e) => expect($e->errors())->toHaveKey('code'))
        ->and(fn () => CompleteManifest::run(Actor::system($admin, 'test'), ['code' => 'abc']))->toThrow(Problem::class);

    $again = $start($admin)['state'];
    GitHubApp::factory()->create();
    expect(fn () => CompleteManifest::run(Actor::system($admin, 'test'), ['code' => 'abc', 'state' => $again]))->toThrow(fn (Problem $e) => expect($e->reason)->toBe('github_connected'));
});

it('refuses a second app that came in while GitHub answered', function () use ($start) {
    $admin = User::factory()->admin()->create();
    $state = $start($admin)['state'];
    // GitHub answers while another request stores an app
    Http::fake(function () {
        GitHubApp::factory()->create();

        return Http::response(['id' => 1, 'slug' => 's', 'name' => 'n', 'owner' => ['login' => 'o', 'type' => 'User'], 'html_url' => 'https://github.com/apps/s', 'pem' => 'p', 'webhook_secret' => 'w'], 201);
    });

    expect(fn () => CompleteManifest::run(Actor::system($admin, 'test'), ['code' => 'abc', 'state' => $state]))->toThrow(fn (Problem $e) => expect($e->reason)->toBe('github_connected'))
        ->and(GitHubApp::query()->count())->toBe(1);
});

it('answers 503 and keeps nothing when GitHub refuses or answers without a key', function () use ($start) {
    $admin = User::factory()->admin()->create();
    $fake = (new FakeGitHub)->fake();
    $fake->refuse = ['/app-manifests/*' => 422];

    expect(fn () => CompleteManifest::run(Actor::system($admin, 'test'), ['code' => 'abc', 'state' => $start($admin)['state']]))
        ->toThrow(fn (Problem $e) => expect([$e->getStatusCode(), $e->reason])->toBe([503, 'github_unavailable']));

    $fake->refuse = [];
    $fake->conversionChanges = ['pem' => null];
    expect(fn () => CompleteManifest::run(Actor::system($admin, 'test'), ['code' => 'abc', 'state' => $start($admin)['state']]))
        ->toThrow(fn (Problem $e) => expect($e->reason)->toBe('github_unavailable'))
        ->and(GitHubApp::query()->exists())->toBeFalse();
});

it('starts the flow over REST only from the session and never answers a key or secret', function () {
    $admin = User::factory()->admin()->create();
    $this->postJson('/api/v1/github/manifest', [], ['Authorization' => 'Bearer '.apiToken($admin, ['read', 'write'])])
        ->assertForbidden()->assertJsonPath('reason', 'session_required');

    forgetApiAuth();
    $this->actingAs($admin, 'web');
    $this->postJson('/api/v1/github/manifest', ['organization' => 'feldwerk'])->assertOk()
        ->assertJsonPath('data.manifest.default_events', Manifest::EVENTS);

    $app = GitHubApp::factory()->create();
    $answer = $this->getJson('/api/v1/github')->assertOk();
    expect($answer->json('data.app.slug'))->toBe('feldwerk-werkbuch')
        ->and($answer->json('data.app.install_url'))->toBe('https://github.com/apps/feldwerk-werkbuch/installations/new')
        ->and($answer->getContent())->not->toContain('PRIVATE KEY')->not->toContain($app->webhook_secret);
    $this->postJson('/api/v1/github/manifest')->assertConflict()->assertJsonPath('reason', 'github_connected');
});
