<?php

use App\Access\ProjectRole;
use App\Actions\GitHub\LinkRepository;
use App\Actions\GitHub\SyncGitHub;
use App\Events\EventType;
use App\Exceptions\Problem;
use App\GitHub\GitHubApi;
use App\GitHub\GitHubUnavailable;
use App\Models\GitHubApp;
use App\Models\GitHubInstallation;
use App\Models\GitHubRepository;
use App\Models\Project;
use App\Models\ProjectRepository;
use App\Models\User;
use App\Support\Actor;
use Illuminate\Database\UniqueConstraintViolationException;
use Illuminate\Http\Client\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Str;
use Illuminate\Validation\ValidationException;
use Tests\Support\FakeGitHub;

/*
 * The installations and repos of the apps (spec 10.2, one app per GitHub account, A680) and the repo of a project (spec 4, 10.3): read from a false GitHub,
 * one repo per project and one project per repo, the base branch, the ruleset hint.
 */

beforeEach(function () {
    $this->github = FakeGitHub::connected();
    $this->admin = User::factory()->admin()->create();
    $this->project = Project::factory()->identifier('WEB')->create();
});

it('reads installations and repos from GitHub, removes what is gone and keeps the link of a project', function () {
    $other = GitHubRepository::factory()->create(['github_id' => 700_000_009, 'full_name' => 'feldwerk/alt']);
    $gone = GitHubInstallation::factory()->create(['installation_id' => 55_000_099]);
    $link = FakeGitHub::link($this->project);
    $this->github->installations[] = FakeGitHub::installationJson(55_000_002, 'hauss', '2026-11-20T10:00:00Z');
    $this->github->repositories[55_000_001][] = FakeGitHub::repositoryJson(700_000_002, 'feldwerk/app', 'develop');
    $this->github->rules['feldwerk/website:main'] = [['type' => 'deletion'], ['type' => 'pull_request', 'ruleset_source_type' => 'Repository', 'ruleset_source' => 'feldwerk/website', 'ruleset_id' => 42, 'parameters' => []]];

    $status = SyncGitHub::run(Actor::system($this->admin, 'test'));

    expect($status['repositories']->pluck('full_name')->all())->toBe(['feldwerk/alt', 'feldwerk/app', 'feldwerk/website'])
        ->and(GitHubRepository::query()->where('full_name', 'feldwerk/app')->sole()->default_branch)->toBe('develop')
        ->and($other->fresh()->removed_at)->not->toBeNull()
        ->and($gone->fresh()->removed_at)->not->toBeNull()
        ->and(GitHubInstallation::query()->where('installation_id', 55_000_002)->sole()->suspended_at?->toJSON())->toBe('2026-11-20T10:00:00.000000Z')
        ->and($link->fresh()->protected)->toBeTrue()
        ->and($link->fresh()->protected_checked_at)->not->toBeNull();

    // the token of the sync reads only metadata; the suspended installation is not asked
    Http::assertSent(fn ($request) => str_contains($request->url(), '/app/installations/55000001/access_tokens') && $request['permissions'] === ['metadata' => 'read'] && ! isset($request['repository_ids']));
    Http::assertNotSent(fn ($request) => str_contains($request->url(), '/app/installations/55000002/access_tokens'));

    // the repo comes back to the installation
    $this->github->repositories[55_000_001][] = FakeGitHub::repositoryJson(700_000_009, 'feldwerk/alt');
    SyncGitHub::run(Actor::system($this->admin, 'test'));
    expect($other->fresh()->removed_at)->toBeNull();
});

it('passes over an installation without a numeric id and a repo without a name', function () {
    $this->github->installations[] = [...FakeGitHub::installationJson(55_000_003, 'broken'), 'id' => '55000003'];
    $this->github->repositories[55_000_001][] = array_diff_key(FakeGitHub::repositoryJson(700_000_004, 'feldwerk/nameless'), ['full_name' => true]);
    $this->github->repositories[55_000_001][] = [...FakeGitHub::repositoryJson(700_000_005, 'feldwerk/textid'), 'id' => '700000005'];

    $status = SyncGitHub::run(Actor::system($this->admin, 'test'));

    expect($status['apps']->sole()->installations->pluck('installation_id')->all())->toBe([55_000_001])
        ->and($status['repositories']->pluck('full_name')->all())->toBe(['feldwerk/website'])
        ->and(GitHubRepository::query()->whereIn('github_id', [700_000_004, 700_000_005])->exists())->toBeFalse();
});

it('never takes a list of repos as complete that GitHub answered only in part', function () {
    $link = FakeGitHub::link($this->project);
    // GitHub says there are 1 200 repos, but its pages end after one
    $this->github->totalCount = 1_200;

    expect(fn () => SyncGitHub::pull(GitHubApp::query()->sole()))->toThrow(GitHubUnavailable::class, 'GitHub answered 1200 rows of repositories but gave 1.')
        ->and(fn () => SyncGitHub::run(Actor::system($this->admin, 'test')))->toThrow(Problem::class)
        ->and(GitHubRepository::query()->whereNotNull('removed_at')->exists())->toBeFalse()
        ->and($link->fresh()->repository->removed_at)->toBeNull();

    // more pages than werkbuch reads: incomplete as well
    $this->github->totalCount = null;
    $this->github->endless = true;
    expect(fn () => SyncGitHub::pull(GitHubApp::query()->sole()))->toThrow(GitHubUnavailable::class, 'GitHub answered more than '.GitHubApi::MAX_PAGES.' pages.')
        ->and(GitHubRepository::query()->whereNotNull('removed_at')->exists())->toBeFalse();
});

it('reads every app with its own token and leaves the installations of the other apps alone', function () {
    $second = $this->github->secondApp();
    $this->github->repositories[55_000_002][] = FakeGitHub::repositoryJson(700_000_003, 'feldwerk-labs/docs');

    $status = SyncGitHub::run(Actor::system($this->admin, 'test'));

    expect($status['apps']->map(fn (GitHubApp $app) => [$app->owner_login, $app->installations->pluck('installation_id')->all()])->all())
        ->toBe([['feldwerk', [55_000_001]], ['feldwerk-labs', [55_000_002]]])
        ->and(GitHubRepository::query()->whereNull('removed_at')->orderBy('full_name')->pluck('full_name')->all())->toBe(['feldwerk-labs/app', 'feldwerk-labs/docs', 'feldwerk/website'])
        ->and(collect($this->github->issued)->map(fn (array $token) => [$token['installation'], $token['app_id']])->all())
        ->toBe([[55_000_001, GitHubApp::query()->where('owner_login', 'feldwerk')->value('app_id')], [55_000_002, $second->app_id]]);

    // GitHub no longer lists the installation of the second app: only it is removed, the first app keeps its own
    $this->github->installations = array_values(array_filter($this->github->installations, fn (array $installation) => $installation['id'] !== 55_000_002));
    SyncGitHub::pull($second);
    expect(GitHubInstallation::query()->whereNotNull('removed_at')->pluck('installation_id')->all())->toBe([55_000_002])
        ->and(GitHubRepository::query()->where('full_name', 'feldwerk-labs/app')->sole()->removed_at)->not->toBeNull()
        ->and(GitHubRepository::query()->where('full_name', 'feldwerk/website')->sole()->removed_at)->toBeNull();

    // an app disconnected while GitHub answered: what GitHub said belongs to nobody
    $this->github->installations[] = FakeGitHub::installationJson(55_000_002, 'feldwerk-labs', null, $second->app_id);
    $this->github->meanwhile = function (Request $request) use ($second): void {
        if (str_contains($request->url(), 'installation/repositories')) {
            GitHubApp::query()->whereKey($second->id)->delete();
        }
    };
    SyncGitHub::pull($second);
    expect(GitHubInstallation::query()->pluck('installation_id')->all())->toBe([55_000_001]);
});

it('says an instance without an app has nothing to sync', function () {
    GitHubApp::query()->delete();
    expect(fn () => SyncGitHub::run(Actor::system($this->admin, 'test')))->toThrow(fn (Problem $e) => expect([$e->getStatusCode(), $e->reason])->toBe([409, 'github_not_connected']));
});

it('syncs over REST for org admins only and answers 503 when GitHub refuses', function () {
    $this->actingAs(User::factory()->create(), 'web');
    $this->postJson('/api/v1/github/sync')->assertForbidden();

    forgetApiAuth();
    $this->actingAs($this->admin, 'web');
    $this->postJson('/api/v1/github/sync')->assertOk()->assertJsonPath('data.repositories.0.full_name', 'feldwerk/website');

    $this->github->refuse = ['/app/installations' => 500];
    $this->postJson('/api/v1/github/sync')->assertStatus(503)->assertJsonPath('reason', 'github_unavailable');
});

it('says a repo of a project the reader does not see is taken without naming the project', function () {
    $secret = Project::factory()->identifier('OPS')->create(['visibility' => 'private']);
    FakeGitHub::link($secret);
    $this->actingAs(User::factory()->create(), 'web');

    $this->getJson('/api/v1/github')->assertOk()
        ->assertJsonPath('data.repositories.0.taken', true)
        ->assertJsonPath('data.repositories.0.project', null);
});

it('gives a project its repo with the default branch and the ruleset hint', function () {
    $repository = GitHubRepository::query()->sole();
    $this->github->rules['feldwerk/website:main'] = [['type' => 'update']];
    $this->actingAs($this->admin, 'web');

    $this->putJson('/api/v1/projects/WEB/repository', ['repository_id' => 'feldwerk/website'])->assertOk()
        ->assertJsonPath('data.repository.id', $repository->id)
        ->assertJsonPath('data.base_branch', 'main')
        ->assertJsonPath('data.protected', true)
        ->assertJsonPath('data.guard', null);

    $event = eventsOf(EventType::ProjectRepositoryChanged)->sole();
    expect($event->changes)->toBe(['repository' => ['old' => null, 'new' => 'feldwerk/website'], 'base_branch' => ['old' => null, 'new' => 'main']]);

    // the same again changes nothing
    $this->putJson('/api/v1/projects/WEB/repository', ['repository_id' => strtoupper($repository->id), 'base_branch' => 'main'])->assertOk();
    expect(eventsOf(EventType::ProjectRepositoryChanged))->toHaveCount(1);

    // another branch: GitHub knows no rule for it
    $this->putJson('/api/v1/projects/WEB/repository', ['repository_id' => $repository->id, 'base_branch' => 'release/2026'])->assertOk()
        ->assertJsonPath('data.protected', false);
    expect(eventsOf(EventType::ProjectRepositoryChanged)->last()->changes)->toBe(['base_branch' => ['old' => 'main', 'new' => 'release/2026']]);

    $this->getJson('/api/v1/projects/WEB/repository')->assertOk()->assertJsonPath('data.base_branch', 'release/2026');

    $this->putJson('/api/v1/projects/WEB/repository', ['repository_id' => null])->assertOk()->assertJsonPath('data', null);
    expect(ProjectRepository::query()->exists())->toBeFalse();
    $this->getJson('/api/v1/projects/WEB/repository')->assertOk()->assertJsonPath('data', null);
    $this->putJson('/api/v1/projects/WEB/repository', ['repository_id' => null])->assertOk();
    expect(eventsOf(EventType::ProjectRepositoryChanged))->toHaveCount(3);
});

it('keeps a repository in at most one project', function () {
    FakeGitHub::link(Project::factory()->identifier('APP')->create());
    $this->actingAs($this->admin, 'web');

    $this->putJson('/api/v1/projects/WEB/repository', ['repository_id' => 'feldwerk/website'])->assertUnprocessable()
        ->assertJsonPath('errors.repository_id.0', __('field.repository_id.taken'));
    expect(ProjectRepository::query()->count())->toBe(1);

    // the unique index catches what two requests at once would do
    $repository = GitHubRepository::query()->sole();
    expect(fn () => ProjectRepository::factory()->create(['project_id' => $this->project->id, 'repository_id' => $repository->id]))
        ->toThrow(UniqueConstraintViolationException::class);
});

it('takes a repo the unique index refuses at the last moment as taken', function () {
    $repository = GitHubRepository::query()->sole();
    $other = Project::factory()->identifier('APP')->create();
    // another request links the repo right after the check under the lock
    DB::beforeExecuting(function (string $sql) use ($repository, $other) {
        static $once = false;
        if (! $once && str_starts_with($sql, 'insert into `project_repositories`')) {
            $once = true;
            DB::table('project_repositories')->insert(['id' => (string) Str::ulid(), 'project_id' => $other->id, 'repository_id' => $repository->id, 'base_branch' => 'main', 'created_at' => now(), 'updated_at' => now()]);
        }
    });

    expect(fn () => LinkRepository::run(Actor::system($this->admin, 'test'), $this->project, ['repository_id' => $repository->id]))
        ->toThrow(fn (ValidationException $e) => expect($e->errors())->toBe(['repository_id' => [__('field.repository_id.taken')]]));
});

it('refuses an unknown or removed repo, a branch git does not take, and people who are no admins of the project', function () {
    $removed = GitHubRepository::factory()->create(['full_name' => 'feldwerk/old', 'removed_at' => now()]);
    $act = fn (array $input, ?User $user = null) => LinkRepository::run(Actor::system($user ?? $this->admin, 'test'), 'WEB', $input);

    foreach ([['repository_id' => 'feldwerk/none'], ['repository_id' => $removed->id], ['repository_id' => 42]] as $input) {
        expect(fn () => $act($input))->toThrow(fn (ValidationException $e) => expect($e->errors())->toBe(['repository_id' => [__('field.repository_id.unknown')]]));
    }
    foreach (['a b', '-x', 'a..b', 'x.lock', 'a/', '/a', 'a//b', 'a@{b', 'a/.b', 'x.', 'a~b', 'a\\b', str_repeat('a', 256), ['main']] as $branch) {
        expect(fn () => $act(['repository_id' => 'feldwerk/website', 'base_branch' => $branch]))
            ->toThrow(fn (ValidationException $e) => expect($e->errors())->toBe(['base_branch' => [__('field.base_branch.invalid')]]));
    }

    $member = memberOf($this->project, ProjectRole::Member);
    expect(fn () => $act(['repository_id' => 'feldwerk/website'], $member))->toThrow(fn (Problem $e) => expect([$e->getStatusCode(), $e->detail])->toBe([403, __('problem.detail.repository_admins_only')]))
        ->and(fn () => $act(['repository_id' => 'feldwerk/website'], User::factory()->create()))->toThrow(fn (Problem $e) => expect($e->getStatusCode())->toBe(403))
        ->and(fn () => LinkRepository::run(Actor::system($this->admin, 'test'), 'NOPE', []))->toThrow(fn (Problem $e) => expect($e->getStatusCode())->toBe(404));
});

it('asks GitHub about the ruleset of a repo with the app whose installation reaches it', function () {
    $second = $this->github->secondApp();
    $this->github->rules['feldwerk-labs/app:main'] = [['type' => 'update']];

    $link = LinkRepository::run(Actor::system($this->admin, 'test'), $this->project, ['repository_id' => 'feldwerk-labs/app']);

    expect($link?->protected)->toBeTrue()
        ->and(collect($this->github->issued)->map(fn (array $token) => [$token['installation'], $token['app_id']])->all())->toBe([[55_000_002, $second->app_id]]);
});

it('leaves the ruleset unknown when GitHub cannot say', function () {
    $this->github->refuse = ['/repos/*' => 403];
    $link = LinkRepository::run(Actor::system($this->admin, 'test'), $this->project, ['repository_id' => 'feldwerk/website']);
    expect($link?->protected)->toBeNull()->and($link?->protected_checked_at)->toBeNull();

    $this->github->refuse = ['/app/installations/*' => 500];
    expect(LinkRepository::run(Actor::system($this->admin, 'test'), $this->project, ['repository_id' => 'feldwerk/website', 'base_branch' => 'dev'])?->protected)->toBeNull();

    GitHubInstallation::query()->update(['suspended_at' => now()]);
    expect(LinkRepository::run(Actor::system($this->admin, 'test'), $this->project, ['repository_id' => 'feldwerk/website', 'base_branch' => 'main'])?->protected)->toBeNull();
});
