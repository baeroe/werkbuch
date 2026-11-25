<?php

use App\Actions\GitHub\CompleteManifest;
use App\Actions\GitHub\StartManifest;
use App\Events\EventType;
use App\Exceptions\Problem;
use App\GitHub\Manifest;
use App\Models\GitHubApp;
use App\Models\User;
use App\Support\Actor;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Http;
use Illuminate\Validation\ValidationException;
use Tests\Support\FakeGitHub;

/*
 * The manifest flow of the app of a GitHub account (spec 10.2, 11.3, WEBU-24, WEBU-35) against a false GitHub: the
 * browser posts the manifest, GitHub sends the person back with a code and the state, the code becomes the app (key and
 * secret encrypted, never in an answer, event or log). One app per account (A680).
 */

$start = function (User $admin, array $input = ['owner' => 'feldwerk', 'owner_type' => 'Organization']): array {
    return StartManifest::run(Actor::system($admin, 'test'), $input);
};

it('starts the manifest flow of an own account with the permissions and events of spec 11.3', function () use ($start) {
    $started = $start(User::factory()->admin()->create(), ['owner' => ' mara-lindqvist ', 'owner_type' => 'User']);

    expect($started['url'])->toBe('https://github.com/settings/apps/new?state='.$started['state'])
        ->and($started['manifest'])->toMatchArray([
            'name' => 'mara-lindqvist werkbuch',
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
    $started = $start(User::factory()->admin()->create(), ['owner' => 'feldwerk-gmbh-mit-einem-sehr-langen-nam', 'owner_type' => 'Organization']);

    expect($started['url'])->toStartWith('https://github.com/organizations/feldwerk-gmbh-mit-einem-sehr-langen-nam/settings/apps/new?state=')
        ->and(mb_strlen($started['manifest']['name']))->toBe(Manifest::NAME_MAX)
        ->and($started['manifest']['name'])->toBe('feldwerk-gmbh-mit-einem-s werkbuch');
});

it('refuses a login that is no GitHub login, an unknown kind of account, members, and an account with an app', function () use ($start) {
    $admin = User::factory()->admin()->create();

    expect(fn () => $start($admin, ['owner' => 'feld--werk', 'owner_type' => 'Team']))->toThrow(fn (ValidationException $e) => expect($e->errors())
        ->toBe(['owner' => [__('field.owner.github_login')], 'owner_type' => [__('field.owner_type.github')]]))
        ->and(fn () => $start($admin, ['owner' => ' ', 'owner_type' => 'User']))->toThrow(fn (ValidationException $e) => expect($e->errors())->toBe(['owner' => [__('field.owner.required')]]))
        ->and(fn () => $start($admin, []))->toThrow(fn (ValidationException $e) => expect($e->errors())->toHaveKeys(['owner', 'owner_type']))
        ->and(fn () => $start($admin, ['owner' => ['x'], 'owner_type' => 'User']))->toThrow(ValidationException::class)
        ->and(fn () => $start(User::factory()->create()))->toThrow(fn (Problem $e) => expect($e->getStatusCode())->toBe(403));

    // one app per account (A680), whatever the case of its login; another account still connects
    GitHubApp::factory()->create();
    expect(fn () => $start($admin, ['owner' => 'Feldwerk', 'owner_type' => 'Organization']))
        ->toThrow(fn (Problem $e) => expect([$e->getStatusCode(), $e->reason, $e->detail])->toBe([409, 'github_connected', __('problem.detail.github_account_connected', ['login' => 'Feldwerk'])]))
        ->and($start($admin, ['owner' => 'feldwerk-labs', 'owner_type' => 'Organization'])['manifest']['name'])->toBe('feldwerk-labs werkbuch');
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

    // the person registered under an account that has its app already (StartManifest named another one)
    $again = $start($admin, ['owner' => 'feldwerk-labs', 'owner_type' => 'Organization'])['state'];
    GitHubApp::factory()->create();
    expect(fn () => CompleteManifest::run(Actor::system($admin, 'test'), ['code' => 'abc', 'state' => $again]))->toThrow(fn (Problem $e) => expect($e->reason)->toBe('github_connected'));
});

it('connects a second app for another GitHub account', function () use ($start) {
    $fake = (new FakeGitHub)->fake();
    $admin = User::factory()->admin()->create();
    GitHubApp::factory()->create();
    $fake->conversionChanges = ['id' => 4_200_456, 'slug' => 'feldwerk-labs-werkbuch', 'name' => 'feldwerk-labs werkbuch', 'owner' => ['login' => 'feldwerk-labs', 'id' => 9_002, 'type' => 'Organization']];

    $app = CompleteManifest::run(Actor::system($admin, 'test'), ['code' => 'abc', 'state' => $start($admin, ['owner' => 'feldwerk-labs', 'owner_type' => 'Organization'])['state']]);

    expect(GitHubApp::query()->orderBy('owner_login')->pluck('owner_login')->all())->toBe(['feldwerk', 'feldwerk-labs'])
        ->and($app->app_id)->toBe(4_200_456);
});

it('refuses an app of the account that came in while GitHub answered', function () use ($start) {
    $admin = User::factory()->admin()->create();
    $state = $start($admin)['state'];
    // GitHub answers while another request stores an app
    Http::fake(function () {
        GitHubApp::factory()->create();

        return Http::response(['id' => 1, 'slug' => 's', 'name' => 'n', 'owner' => ['login' => 'feldwerk', 'type' => 'Organization'], 'html_url' => 'https://github.com/apps/s', 'pem' => 'p', 'webhook_secret' => 'w'], 201);
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
    $this->postJson('/api/v1/github/manifest', ['owner' => 'feldwerk', 'owner_type' => 'Organization'])->assertOk()
        ->assertJsonPath('data.manifest.default_events', Manifest::EVENTS);
    $this->postJson('/api/v1/github/manifest', ['owner' => '-x'])->assertUnprocessable()->assertJsonValidationErrors(['owner', 'owner_type']);

    $app = GitHubApp::factory()->create();
    $answer = $this->getJson('/api/v1/github')->assertOk();
    expect($answer->json('data.apps.0.slug'))->toBe('feldwerk-werkbuch')
        ->and($answer->json('data.apps.0.install_url'))->toBe('https://github.com/apps/feldwerk-werkbuch/installations/new')
        ->and($answer->getContent())->not->toContain('PRIVATE KEY')->not->toContain($app->webhook_secret);
    $this->postJson('/api/v1/github/manifest', ['owner' => 'feldwerk', 'owner_type' => 'Organization'])->assertConflict()->assertJsonPath('reason', 'github_connected');
});
