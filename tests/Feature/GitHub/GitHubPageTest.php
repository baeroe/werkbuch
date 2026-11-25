<?php

use App\Actions\GitHub\StartManifest;
use App\GitHub\AppJwt;
use App\GitHub\GitHubApi;
use App\GitHub\GitHubUnavailable;
use App\Models\GitHubApp;
use App\Models\GitHubRepository;
use App\Models\User;
use App\Support\Actor;
use Illuminate\Http\Client\ConnectionException;
use Illuminate\Support\Facades\Http;
use Tests\Support\FakeGitHub;

/*
 * The ways between GitHub and Settings → GitHub (WEBU-27): the old address, the two ways back from GitHub, the way to
 * the installation; the JWT the app signs itself in with.
 */

it('sends the old address of the page to the settings', function () {
    $this->actingAs(User::factory()->create());
    $this->get('/github')->assertRedirect('/settings/github');
    expect(route('github'))->toEndWith('/github');
});

it('turns the way back of GitHub into the app and sends the person on to the installation', function () {
    (new FakeGitHub)->fake();
    $admin = User::factory()->admin()->create();
    $this->actingAs($admin);
    $state = StartManifest::run(Actor::system($admin, 'test'), ['owner' => 'feldwerk', 'owner_type' => 'Organization'])['state'];

    $redirect = $this->get('/github/manifest?code=abc123&state='.$state)->assertRedirect()->headers->get('Location');
    expect(GitHubApp::query()->sole()->slug)->toBe('feldwerk-werkbuch')
        ->and($redirect)->toStartWith('https://github.com/apps/feldwerk-werkbuch/installations/new?state=');
    // the state of the way back from installing is the admin's, once
    parse_str((string) parse_url((string) $redirect, PHP_URL_QUERY), $query);
    expect(StartManifest::takeState($query['state'], $admin->id, 'setup'))->toBeTrue()
        ->and(StartManifest::takeState($query['state'], $admin->id, 'setup'))->toBeFalse();
});

it('brings a way back that fails to the settings with its sentence', function () {
    (new FakeGitHub)->fake();
    $admin = User::factory()->admin()->create();
    $this->actingAs($admin);

    // a state that is not the person's: the refusal of the problem
    $this->get('/github/manifest?code=abc123&state=nope')->assertRedirect('/settings/github')->assertSessionHas('error', __('problem.detail.github_state'));
    // a code GitHub never gives: the sentence of the field
    $this->get('/github/manifest?code=no%20code&state=x')->assertRedirect('/settings/github')->assertSessionHas('error', __('field.code.github'));
    // an app of the account that is there already: the sentence of the problem
    GitHubApp::factory()->create();
    $state = StartManifest::issueState($admin->id);
    $this->get('/github/manifest?code=abc123&state='.$state)->assertRedirect('/settings/github')
        ->assertSessionHas('error', __('problem.detail.github_account_connected_created', ['login' => 'feldwerk', 'slug' => 'feldwerk-werkbuch']));
    expect(GitHubApp::query()->count())->toBe(1);
});

it('reads the installation again only with the state werkbuch gave for the way back from GitHub', function () {
    $github = FakeGitHub::connected();
    $github->repositories[55_000_001][] = FakeGitHub::repositoryJson(700_000_003, 'feldwerk/neu');
    $member = User::factory()->create();
    $admin = User::factory()->admin()->create();
    $fresh = fn () => GitHubRepository::query()->where('full_name', 'feldwerk/neu')->exists();

    // no state, a state of somebody else, a state for another way: the address alone changes nothing (A518)
    $this->actingAs($member);
    $this->get('/github/setup?installation_id=55000001&setup_action=update&state='.StartManifest::issueState($member->id, 'setup'))->assertRedirect('/settings/github');
    $this->actingAs($admin);
    $this->get('/github/setup?installation_id=55000001&setup_action=update')->assertRedirect('/settings/github');
    $this->get('/github/setup?state='.StartManifest::issueState($member->id, 'setup'))->assertRedirect('/settings/github');
    $this->get('/github/setup?state='.StartManifest::issueState($admin->id))->assertRedirect('/settings/github');
    expect($fresh())->toBeFalse();
    Http::assertNothingSent();

    // the way to the installation of an app gives the admin a state of their own: GitHub sends it back
    $link = $this->get('/github/install?app='.strtoupper(GitHubApp::query()->sole()->id))->assertRedirect()->headers->get('Location');
    expect($link)->toStartWith('https://github.com/apps/feldwerk-werkbuch/installations/new?state=');
    parse_str((string) parse_url((string) $link, PHP_URL_QUERY), $query);
    $this->get('/github/setup?installation_id=55000001&setup_action=update&state='.$query['state'])->assertRedirect('/settings/github')->assertSessionMissing('error');
    expect($fresh())->toBeTrue();
    // once
    GitHubRepository::query()->where('full_name', 'feldwerk/neu')->delete();
    $this->get('/github/setup?state='.$query['state'])->assertRedirect('/settings/github');
    expect($fresh())->toBeFalse();
});

it('reads only the app of the installation GitHub names on the way back', function () {
    $github = FakeGitHub::connected();
    $second = $github->secondApp();
    $first = GitHubApp::query()->where('owner_login', 'feldwerk')->sole();
    $admin = User::factory()->admin()->create();
    $this->actingAs($admin);
    $apps = fn () => collect($github->issued)->pluck('app_id')->unique()->values()->all();

    // the installation werkbuch knows names its app, whatever app the state was given for
    $this->get('/github/setup?installation_id=55000002&setup_action=update&state='.StartManifest::issueState($admin->id, 'setup', $first->id))->assertRedirect('/settings/github');
    expect($apps())->toBe([$second->app_id]);

    // a new installation: the app of the state
    $github->issued = [];
    $this->get('/github/setup?installation_id=55000099&setup_action=install&state='.StartManifest::issueState($admin->id, 'setup', $first->id))->assertRedirect('/settings/github');
    expect($apps())->toBe([$first->app_id]);

    // a state without an app (from before): every app
    $github->issued = [];
    $this->get('/github/setup?state='.StartManifest::issueState($admin->id, 'setup'))->assertRedirect('/settings/github');
    expect($apps())->toBe([$first->app_id, $second->app_id]);
});

it('brings a way back from installing that GitHub does not answer to the settings with its sentence', function () {
    $github = FakeGitHub::connected();
    $github->refuse['/app/installations'] = 500;
    $admin = User::factory()->admin()->create();
    $this->actingAs($admin);

    $this->get('/github/setup?state='.StartManifest::issueState($admin->id, 'setup'))
        ->assertRedirect('/settings/github')->assertSessionHas('error', __('problem.detail.github_sync_failed', ['logins' => 'feldwerk']));
});

it('sends only an org admin to the installation of an app the instance has', function () {
    $this->actingAs(User::factory()->admin()->create());
    $this->get('/github/install')->assertRedirect('/settings/github')->assertSessionMissing('error');
    $this->get('/github/install?app=01J00000000000000000000000')->assertRedirect('/settings/github')->assertSessionMissing('error');
    $this->get('/github/install?app=feldwerk')->assertRedirect('/settings/github');

    $github = FakeGitHub::connected();
    $second = $github->secondApp();
    expect($this->get('/github/install?app='.$second->id)->headers->get('Location'))->toStartWith('https://github.com/apps/feldwerk-labs-werkbuch/installations/new?state=');

    $this->actingAs(User::factory()->create());
    $this->get('/github/install?app='.$second->id)->assertRedirect('/settings/github')->assertSessionHas('error', __('problem.detail.github_admins_only'));
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
