<?php

use App\Actions\GitHub\StartManifest;
use App\GitHub\AppJwt;
use App\GitHub\GitHubApi;
use App\GitHub\GitHubUnavailable;
use App\Models\GitHubApp;
use App\Models\GitHubInstallation;
use App\Models\GitHubRepository;
use App\Models\Project;
use App\Models\ProjectRepository;
use App\Models\User;
use App\Support\Actor;
use Illuminate\Http\Client\ConnectionException;
use Illuminate\Support\Facades\Http;
use Tests\Support\FakeGitHub;

/*
 * The plain page of the app (WEBU-24) and the two ways back from GitHub; the JWT the app signs itself in with.
 */

it('shows an org admin the form that posts the manifest to GitHub, a member only the state', function () {
    $this->actingAs(User::factory()->admin()->create());
    $page = $this->get('/github?organization=feldwerk')->assertOk()
        ->assertSee('action="https://github.com/organizations/feldwerk/settings/apps/new?state=', false)
        ->assertSee('name="manifest"', false)
        ->assertSee(__('github.page.connect'));
    expect(html_entity_decode($page->getContent()))->toContain('"default_events":["pull_request","push","check_suite","check_run"]');

    $this->get('/github?organization=a--b')->assertOk()->assertSee(__('field.organization.github_login'))
        ->assertSee('action="https://github.com/settings/apps/new?state=', false);

    $this->actingAs(User::factory()->create());
    $this->get('/github')->assertOk()->assertSee(__('github.page.none'))->assertSee(__('problem.detail.github_admins_only'))->assertDontSee('name="manifest"', false);
});

it('shows the app, its installations and repos with their project and never its key', function () {
    FakeGitHub::connected();
    $app = GitHubApp::query()->sole();
    FakeGitHub::link(Project::factory()->identifier('WEB')->create(), 'feldwerk/website', 'main')->forceFill(['protected' => true, 'guard_detected_at' => now()])->save();
    GitHubInstallation::query()->first()->forceFill(['suspended_at' => now()])->save();
    GitHubInstallation::factory()->create(['account_login' => 'hauss', 'removed_at' => now()]);
    GitHubRepository::factory()->create(['full_name' => 'feldwerk/frei', 'removed_at' => now()]);
    $hidden = Project::factory()->identifier('OPS')->create(['visibility' => 'private']);
    ProjectRepository::factory()->create(['project_id' => $hidden->id, 'protected' => false]);

    $this->actingAs(User::factory()->admin()->create());
    $this->get('/github')->assertOk()->assertSee('Feldwerk werkbuch')->assertSee('feldwerk/website')->assertSee('WEB')
        ->assertSee(__('github.page.protected'))->assertSee(__('github.page.guarded'))->assertSee(__('github.page.install'))
        ->assertSee(__('github.page.suspended'))->assertSee(__('github.page.removed'))->assertSee(__('github.page.unprotected'))
        ->assertDontSee($app->webhook_secret)->assertDontSee('PRIVATE KEY');

    $this->actingAs(User::factory()->create());
    $this->get('/github')->assertOk()->assertSee(__('github.page.taken'))->assertDontSee(__('github.page.install'));

    GitHubRepository::query()->delete();
    GitHubInstallation::query()->delete();
    $this->get('/github')->assertOk()->assertSee(__('github.page.no_installations'))->assertSee(__('github.page.no_repositories'));
});

it('turns the way back of GitHub into the app and sends the person on to the installation', function () {
    (new FakeGitHub)->fake();
    $admin = User::factory()->admin()->create();
    $this->actingAs($admin);
    $this->get('/github')->assertOk();
    // the state of a start the person makes (the page shows another one)
    $state = StartManifest::run(Actor::system($admin, 'test'), [])['state'];

    $this->get('/github/manifest?code=abc123&state='.$state)->assertRedirect('https://github.com/apps/feldwerk-werkbuch/installations/new');
    expect(GitHubApp::query()->sole()->slug)->toBe('feldwerk-werkbuch');

    $this->get('/github/manifest?code=abc123&state=nope')->assertForbidden();
});

it('reads the installation again after GitHub sends the person to setup', function () {
    $github = FakeGitHub::connected();
    $github->repositories[55_000_001][] = FakeGitHub::repositoryJson(700_000_003, 'feldwerk/neu');
    $this->actingAs(User::factory()->create());
    $this->get('/github/setup?installation_id=55000001&setup_action=update')->assertRedirect('/github');
    Http::assertNothingSent();

    $this->actingAs(User::factory()->admin()->create());
    $this->get('/github/setup?installation_id=55000001&setup_action=update')->assertRedirect('/github');
    expect(GitHubRepository::query()->where('full_name', 'feldwerk/neu')->exists())->toBeTrue();
});

it('signs the app in with a JWT GitHub can check with the public key', function () {
    $app = GitHubApp::factory()->create(['app_id' => 4_200_123]);
    [$header, $payload, $signature] = explode('.', AppJwt::for($app, 1_800_000_000));
    $decode = fn (string $part) => base64_decode(strtr($part, '-_', '+/'));
    $public = openssl_pkey_get_details(openssl_pkey_get_private($app->private_key))['key'];

    expect(json_decode($decode($header), true))->toBe(['alg' => 'RS256', 'typ' => 'JWT'])
        ->and(json_decode($decode($payload), true))->toBe(['iat' => 1_799_999_940, 'exp' => 1_800_000_540, 'iss' => '4200123'])
        ->and(openssl_verify("{$header}.{$payload}", $decode($signature), $public, OPENSSL_ALGO_SHA256))->toBe(1);

    $app->private_key = 'no key';
    expect(fn () => AppJwt::for($app, 1))->toThrow(GitHubUnavailable::class);
});

it('treats an answer without a token and a GitHub without an answer as unavailable', function () {
    $app = GitHubApp::factory()->create();
    $answers = [
        fn () => Http::response(['expires_at' => 'x'], 201),
        fn () => throw new ConnectionException('down'),
        fn () => Http::response('not json', 200),
    ];
    Http::fake(function () use (&$answers) {
        return array_shift($answers)();
    });

    expect(fn () => GitHubApi::accessToken($app, 1, null, null))->toThrow(GitHubUnavailable::class)
        ->and(fn () => GitHubApi::installations($app))->toThrow(fn (GitHubUnavailable $e) => expect([$e->reason, $e->status])->toBe(['github', null]));
    expect(GitHubApi::repositories('t'))->toBe([]);
});
