<?php

use App\Access\ProjectRole;
use App\Actions\GitHub\ConfirmMergeGuard;
use App\Actions\GitHub\DetectUnauthorizedPush;
use App\Actions\GitHub\DisconnectGitHub;
use App\Actions\GitHub\LinkRepository;
use App\Domain\Agents\RunStatus;
use App\Domain\Agents\RunType;
use App\Events\EventType;
use App\Exceptions\Problem;
use App\Jobs\ProcessGitHubDelivery;
use App\Models\AgentThread;
use App\Models\Comment;
use App\Models\GitHubApp;
use App\Models\GitHubDelivery;
use App\Models\GitHubInstallation;
use App\Models\GitHubRepository;
use App\Models\Project;
use App\Models\ProjectRepository;
use App\Models\User;
use App\Models\WorkItem;
use App\Support\Actor;
use App\Support\OwnMerges;
use App\Support\RunQueue;
use Illuminate\Contracts\Debug\ExceptionHandler;
use Illuminate\Support\Facades\Queue;
use Illuminate\Validation\ValidationException;
use Tests\Support\AgentWorld;
use Tests\Support\FakeGitHub;

/*
 * The guard against an unauthorized merge (spec 11.3): a push of the app to the base branch of a project that no merge
 * of werkbuch explains pauses every strand of the project, cancels what runs and holds what waits, says so at the item
 * of the run and to the org admins, until an admin of the project confirms.
 */

beforeEach(function () {
    $this->github = FakeGitHub::connected();
    $this->project = Project::factory()->identifier('WEB')->create();
    $this->agent = AgentWorld::agent([$this->project]);
    $this->link = FakeGitHub::link($this->project);
    $this->admin = User::factory()->admin()->create(['handle' => 'mara']);
});

it('pauses the threads of a project when the app pushes to its base branch outside a werkbuch merge', function () {
    $item = WorkItem::factory()->create(['project_id' => $this->project->id, 'title' => 'Login']);
    $thread = AgentThread::factory()->create(['bot_id' => $this->agent->id, 'project_id' => $this->project->id, 'work_item_id' => $item->id]);
    $other = AgentThread::factory()->create(['bot_id' => $this->agent->id, 'project_id' => $this->project->id]);
    [$runner] = AgentWorld::runner();
    $running = AgentWorld::run($this->agent, $item, RunType::Task, ['status' => RunStatus::Running, 'runner_id' => $runner->id, 'thread_id' => $thread->id, 'started_at' => now(), 'lease_expires_at' => now()->addMinute()]);
    $queued = AgentWorld::run($this->agent, $this->project, RunType::Review);
    $elsewhere = AgentWorld::run($this->agent, Project::factory()->create());
    $sha = str_repeat('a', 40);

    FakeGitHub::deliver($this, 'push', FakeGitHub::push($sha), 'd-push')->assertStatus(202);

    $link = $this->link->fresh();
    expect($link->guarded())->toBeTrue()
        ->and([$link->guard_sha, $link->guard_branch, $link->guard_run_id, $link->guard_item_id, $link->guard_bot_id])->toBe([$sha, 'main', $running->id, $item->id, $this->agent->id])
        ->and([$thread->fresh()->status, $thread->fresh()->pause_reason, $other->fresh()->status])->toBe([AgentThread::PAUSED, 'guard', AgentThread::PAUSED])
        ->and($running->fresh()->status)->toBe(RunStatus::Canceling)
        ->and([$queued->fresh()->status, $queued->fresh()->waiting_reason])->toBe([RunStatus::Waiting, 'merge_guard'])
        ->and($elsewhere->fresh()->status)->toBe(RunStatus::Queued)
        ->and(GitHubDelivery::query()->sole()->outcome)->toBe('foreign');

    $event = eventsOf(EventType::ProjectMergeGuardDetected)->sole();
    expect($event->changes)->toBe(['guard' => ['old' => null, 'new' => $sha]])
        ->and($event->meta)->toMatchArray(['branch' => 'main', 'run_id' => $running->id, 'item_id' => $item->id, 'paused' => 2, 'canceled' => 1]);

    // werkbuch says so at the item of the run and mentions the org admins
    $comment = Comment::query()->where('work_item_id', $item->id)->sole();
    expect($comment->body_text)->toContain('main')->toContain('aaaaaaa')->toContain('WEB')->toContain('@mara')
        ->and($comment->author_id)->toBe(User::defaultBot()->id)
        ->and(eventsOf(EventType::CommentCreated)->sole()->meta['mentioned'] ?? [])->toContain($this->admin->id);

    // no run of the project starts while the guard holds it, and the reason stays
    [, $token] = AgentWorld::runner(['name' => 'second']);
    $this->postJson('/api/runner/claim', [], AgentWorld::headers($token))->assertOk()->assertJsonPath('run.id', $elsewhere->id);
    RunQueue::refreshReasons();
    expect($queued->fresh()->waiting_reason)->toBe('merge_guard');

    // a second push while the guard holds changes nothing
    FakeGitHub::deliver($this, 'push', FakeGitHub::push(str_repeat('b', 40)), 'd-push-2')->assertStatus(202);
    expect(eventsOf(EventType::ProjectMergeGuardDetected))->toHaveCount(1)->and($this->link->fresh()->guard_sha)->toBe($sha);
});

it('lets a merge of werkbuch, a push of a person, another branch or repo and a deleted branch pass', function () {
    $merge = OwnMerges::expect($this->link->repository_id, 12);
    OwnMerges::merged($merge, str_repeat('C', 40));
    $act = fn (array $payload) => DetectUnauthorizedPush::run(Actor::system(User::defaultBot(), 'test'), $payload);

    expect($act(FakeGitHub::push(str_repeat('c', 40))))->toBe('own')
        ->and($act(FakeGitHub::push(str_repeat('d', 40), sender: 'rafael-feldwerk')))->toBe('ignored')
        ->and($act(FakeGitHub::push(str_repeat('d', 40), branch: 'agent/WEB-1-login')))->toBe('ignored')
        ->and($act(FakeGitHub::push(str_repeat('d', 40), repositoryId: 999)))->toBe('ignored')
        ->and($act([...FakeGitHub::push(str_repeat('0', 40)), 'deleted' => true]))->toBe('ignored')
        ->and($act(['ref' => 'refs/tags/v1', 'after' => str_repeat('d', 40)]))->toBe('ignored')
        ->and($act([...FakeGitHub::push('nohex'), 'after' => 'nohex']))->toBe('ignored')
        ->and($this->link->fresh()->guarded())->toBeFalse();

    GitHubApp::query()->delete();
    expect($act(FakeGitHub::push(str_repeat('d', 40))))->toBe('ignored');
});

it('waits with a push while a merge of werkbuch has no commit yet, then decides', function () {
    OwnMerges::expect($this->link->repository_id, 12);
    Queue::fake([ProcessGitHubDelivery::class]);
    FakeGitHub::deliver($this, 'push', FakeGitHub::push(str_repeat('e', 40)), 'd-wait')->assertStatus(202);
    $id = GitHubDelivery::query()->sole()->id;

    $job = (new ProcessGitHubDelivery($id))->withFakeQueueInteractions();
    $job->handle();
    $job->assertReleased(ProcessGitHubDelivery::PENDING_DELAY);
    expect(GitHubDelivery::query()->sole()->processed_at)->toBeNull()->and($this->link->fresh()->guarded())->toBeFalse();

    // the merge got no commit within five minutes: the push is no merge of werkbuch
    $this->travel(OwnMerges::PENDING_MINUTES + 1)->minutes();
    (new ProcessGitHubDelivery($id))->handle();
    expect($this->link->fresh()->guarded())->toBeTrue()->and(GitHubDelivery::query()->sole()->outcome)->toBe('foreign');
});

it('guards without an item when no or several code runs ran and in a project being deleted not at all', function () {
    $act = fn (string $sha) => DetectUnauthorizedPush::run(Actor::system(User::defaultBot(), 'test'), FakeGitHub::push($sha));
    [$runner] = AgentWorld::runner();
    foreach ([1, 2] as $n) {
        AgentWorld::run($this->agent, $this->project, RunType::Task, ['status' => RunStatus::Running, 'runner_id' => $runner->id, 'started_at' => now()]);
    }

    expect($act(str_repeat('f', 40)))->toBe('foreign')
        ->and($this->link->fresh()->guard_item_id)->toBeNull()
        ->and(Comment::query()->exists())->toBeFalse();

    $deleting = Project::factory()->create(['deleting_at' => now()]);
    $repository = GitHubRepository::factory()->create(['installation_id' => GitHubInstallation::query()->value('id'), 'github_id' => 700_000_005, 'full_name' => 'feldwerk/gone']);
    ProjectRepository::factory()->create(['project_id' => $deleting->id, 'repository_id' => $repository->id]);
    expect(DetectUnauthorizedPush::run(Actor::system(User::defaultBot(), 'test'), FakeGitHub::push(str_repeat('f', 40), repositoryId: 700_000_005, fullName: 'feldwerk/gone')))->toBe('foreign')
        ->and(ProjectRepository::query()->where('project_id', $deleting->id)->sole()->guarded())->toBeFalse();
});

it('keeps the guard when the comment cannot be written', function () {
    $item = WorkItem::factory()->archived()->create(['project_id' => $this->project->id]);
    [$runner] = AgentWorld::runner();
    AgentWorld::run($this->agent, $item, RunType::Task, ['status' => RunStatus::Running, 'runner_id' => $runner->id, 'started_at' => now()]);
    $reported = 0;
    $this->app->make(ExceptionHandler::class)->reportable(function (RuntimeException $e) use (&$reported) {
        $reported++;

        return false;
    });

    expect(DetectUnauthorizedPush::run(Actor::system(User::defaultBot(), 'test'), FakeGitHub::push(str_repeat('a', 40))))->toBe('foreign')
        ->and($this->link->fresh()->guarded())->toBeTrue()
        ->and(Comment::query()->exists())->toBeFalse()
        ->and($reported)->toBe(1);
});

it('lets an admin of the project confirm, opens the paused strands and frees the waiting runs', function () {
    $thread = AgentThread::factory()->create(['bot_id' => $this->agent->id, 'project_id' => $this->project->id, 'status' => AgentThread::PAUSED, 'pause_reason' => 'guard']);
    $braked = AgentThread::factory()->create(['bot_id' => $this->agent->id, 'project_id' => $this->project->id, 'status' => AgentThread::PAUSED, 'pause_reason' => 'brake']);
    $this->link->forceFill(['guard_detected_at' => now(), 'guard_sha' => str_repeat('a', 40), 'guard_branch' => 'main'])->save();
    AgentWorld::runner();
    $waiting = AgentWorld::run($this->agent, $this->project, RunType::Task, ['status' => RunStatus::Waiting, 'waiting_reason' => 'merge_guard']);

    $member = memberOf($this->project, ProjectRole::Member);
    $this->actingAs($member, 'web');
    $this->postJson('/api/v1/projects/WEB/repository/confirm-guard')->assertForbidden();
    $this->putJson('/api/v1/projects/WEB/repository', ['repository_id' => null])->assertForbidden();

    forgetApiAuth();
    $this->actingAs($this->admin, 'web');
    $this->putJson('/api/v1/projects/WEB/repository', ['repository_id' => null])->assertConflict()->assertJsonPath('reason', 'merge_guard_open');
    $this->getJson('/api/v1/projects/WEB/repository')->assertOk()->assertJsonPath('data.guard.sha', str_repeat('a', 40));
    $this->postJson('/api/v1/projects/WEB/repository/confirm-guard')->assertOk()->assertJsonPath('data.guard', null);

    expect([$thread->fresh()->status, $thread->fresh()->pause_reason])->toBe([AgentThread::OPEN, null])
        ->and($braked->fresh()->status)->toBe(AgentThread::PAUSED)
        ->and([$waiting->fresh()->status, $waiting->fresh()->waiting_reason])->toBe([RunStatus::Queued, null])
        ->and(eventsOf(EventType::ProjectMergeGuardConfirmed)->sole()->meta)->toMatchArray(['branch' => 'main', 'thread_ids' => [$thread->id]]);

    $this->postJson('/api/v1/projects/WEB/repository/confirm-guard')->assertConflict()->assertJsonPath('reason', 'nothing_to_confirm');
    expect(fn () => ConfirmMergeGuard::run(Actor::system($this->admin, 'test'), 'NOPE'))->toThrow(Problem::class);
    ProjectRepository::query()->delete();
    $this->postJson('/api/v1/projects/WEB/repository/confirm-guard')->assertConflict();
});

it('disconnects GitHub: the projects lose their repo, their strands pause and their runs end', function () {
    $open = AgentThread::factory()->create(['bot_id' => $this->agent->id, 'project_id' => $this->project->id]);
    $guarded = AgentThread::factory()->create(['bot_id' => $this->agent->id, 'project_id' => $this->project->id, 'status' => AgentThread::PAUSED, 'pause_reason' => 'guard']);
    $folder = Project::factory()->create();
    $elsewhere = AgentThread::factory()->create(['bot_id' => $this->agent->id, 'project_id' => $folder->id]);
    [$runner] = AgentWorld::runner();
    $running = AgentWorld::run($this->agent, $this->project, RunType::Task, ['status' => RunStatus::Running, 'runner_id' => $runner->id, 'started_at' => now()]);
    $queued = AgentWorld::run($this->agent, $this->project);
    $other = AgentWorld::run($this->agent, $folder);

    $this->deleteJson('/api/v1/github', [], ['Authorization' => 'Bearer '.apiToken($this->admin, ['read', 'write'])])->assertForbidden();
    forgetApiAuth();
    $this->actingAs($this->admin, 'web');
    $this->deleteJson('/api/v1/github')->assertOk()->assertExactJson(['canceled' => 2]);

    expect([$open->fresh()->status, $open->fresh()->pause_reason, $guarded->fresh()->pause_reason, $elsewhere->fresh()->status])
        ->toBe([AgentThread::PAUSED, 'github', 'github', AgentThread::OPEN])
        ->and([$running->fresh()->status, $queued->fresh()->status, $other->fresh()->status])->toBe([RunStatus::Canceling, RunStatus::Canceled, RunStatus::Queued])
        ->and([GitHubApp::query()->count(), GitHubInstallation::query()->count(), GitHubRepository::query()->count(), ProjectRepository::query()->count()])->toBe([0, 0, 0, 0])
        ->and(eventsOf(EventType::GitHubDisconnected)->sole()->meta)->toMatchArray(['projects' => 1, 'canceled' => 2]);

    $this->deleteJson('/api/v1/github')->assertConflict()->assertJsonPath('reason', 'github_not_connected');
    expect(fn () => DisconnectGitHub::run(Actor::system(User::factory()->create(), 'test')))->toThrow(Problem::class);
    expect(fn () => LinkRepository::run(Actor::system($this->admin, 'test'), $this->project, ['repository_id' => 'feldwerk/website']))->toThrow(ValidationException::class);
});
