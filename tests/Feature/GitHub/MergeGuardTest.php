<?php

use App\Access\OrgRole;
use App\Access\ProjectRole;
use App\Access\RoleAssignments;
use App\Access\Visibility;
use App\Actions\GitHub\ConfirmMergeGuard;
use App\Actions\GitHub\DetectUnauthorizedPush;
use App\Actions\GitHub\DisconnectGitHub;
use App\Actions\GitHub\LinkRepository;
use App\Actions\Notifications\NotifyRecipients;
use App\Actions\Notifications\SendNotificationMail;
use App\Domain\Agents\RunStatus;
use App\Domain\Agents\RunType;
use App\Domain\Notifications\NotificationKind;
use App\Events\EventType;
use App\Exceptions\Problem;
use App\Jobs\ProcessGitHubDelivery;
use App\Jobs\SendNotificationMailJob;
use App\Mail\NotificationDigest;
use App\Models\AgentThread;
use App\Models\Comment;
use App\Models\GitHubApp;
use App\Models\GitHubDelivery;
use App\Models\GitHubInstallation;
use App\Models\GitHubRepository;
use App\Models\Notification;
use App\Models\NotificationMail;
use App\Models\Project;
use App\Models\ProjectRepository;
use App\Models\User;
use App\Models\WorkItem;
use App\Notifications\NotificationConsumer;
use App\Support\Actor;
use App\Support\OwnMerges;
use App\Support\RunQueue;
use Illuminate\Contracts\Debug\ExceptionHandler;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Mail;
use Illuminate\Support\Facades\Queue;
use Illuminate\Validation\ValidationException;
use Tests\Support\AgentWorld;
use Tests\Support\FakeGitHub;

/*
 * The guard against an unauthorized merge (spec 11.3): a push of the app to the base branch of a project that no merge
 * of werkbuch explains pauses every strand of the project, cancels what runs and holds what waits, says so at the item
 * of the runs it takes for the push and always to the org admins, until an admin of the project confirms.
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
        ->and([$link->guard_sha, $link->guard_branch, $link->guard_runs])->toBe([$sha, 'main', [['run_id' => $running->id, 'item_id' => $item->id, 'bot_id' => $this->agent->id]]])
        ->and([$thread->fresh()->status, $thread->fresh()->pause_reason, $other->fresh()->status])->toBe([AgentThread::PAUSED, 'guard', AgentThread::PAUSED])
        ->and($running->fresh()->status)->toBe(RunStatus::Canceling)
        ->and([$queued->fresh()->status, $queued->fresh()->waiting_reason])->toBe([RunStatus::Waiting, 'merge_guard'])
        ->and($elsewhere->fresh()->status)->toBe(RunStatus::Queued)
        ->and(GitHubDelivery::query()->sole()->outcome)->toBe('foreign');

    $event = eventsOf(EventType::ProjectMergeGuardDetected)->sole();
    expect($event->changes)->toBe(['guard' => ['old' => null, 'new' => $sha]])
        ->and($event->meta)->toMatchArray(['branch' => 'main', 'deleted' => false, 'item_ids' => [$item->id], 'paused' => 2, 'canceled' => 1]);

    // werkbuch says so at the item of the run, without mentions and without code marks, pointing to werkbuch
    $comment = Comment::query()->where('work_item_id', $item->id)->sole();
    expect($comment->body_text)->toContain('main')->toContain('aaaaaaa')->toContain('WEB')->not->toContain('@')
        ->and(json_encode($comment->body))->not->toContain('"code"')
        ->and($comment->author_id)->toBe(User::defaultBot()->id)
        ->and(eventsOf(EventType::CommentCreated)->sole()->meta)->not->toHaveKey('mentioned');

    // no run of the project starts while the guard holds it, and the reason stays
    [, $token] = AgentWorld::runner(['name' => 'second']);
    $this->postJson('/api/runner/claim', [], AgentWorld::headers($token))->assertOk()->assertJsonPath('run.id', $elsewhere->id);
    RunQueue::refreshReasons();
    expect($queued->fresh()->waiting_reason)->toBe('merge_guard');

    // a second push while the guard holds changes nothing
    FakeGitHub::deliver($this, 'push', FakeGitHub::push(str_repeat('b', 40)), 'd-push-2')->assertStatus(202);
    expect(eventsOf(EventType::ProjectMergeGuardDetected))->toHaveCount(1)->and($this->link->fresh()->guard_sha)->toBe($sha);
});

it('lets a merge of werkbuch, a push of a person, another branch or repo and a deleted agent branch pass', function () {
    $merge = OwnMerges::expect($this->link->repository_id, 12);
    OwnMerges::merged($merge, str_repeat('C', 40));
    $act = fn (array $payload) => DetectUnauthorizedPush::run(Actor::system(User::defaultBot(), 'test'), $payload);

    expect($act(FakeGitHub::push(str_repeat('c', 40))))->toBe('own')
        ->and($act(FakeGitHub::push(str_repeat('d', 40), sender: 'rafael-feldwerk')))->toBe('ignored')
        ->and($act(FakeGitHub::push(str_repeat('d', 40), branch: 'agent/WEB-1-login')))->toBe('ignored')
        ->and($act(FakeGitHub::push(str_repeat('d', 40), repositoryId: 999)))->toBe('ignored')
        ->and($act([...FakeGitHub::push(str_repeat('0', 40)), 'before' => str_repeat('0', 40), 'deleted' => true]))->toBe('ignored')
        ->and($act([...FakeGitHub::push(str_repeat('0', 40), branch: 'agent/WEB-1-login'), 'deleted' => true]))->toBe('ignored')
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

it('takes the run that reported the commit, even when it finished before the push came', function () {
    $sha = str_repeat('a', 40);
    $item = WorkItem::factory()->create(['project_id' => $this->project->id]);
    $other = WorkItem::factory()->create(['project_id' => $this->project->id]);
    // the run pushed, reported its commit (short) and finished; the webhook comes later
    $culprit = AgentWorld::run($this->agent, $item, RunType::Task, ['status' => RunStatus::Succeeded, 'started_at' => now()->subHours(3), 'finished_at' => now()->subHours(2), 'result' => ['summary' => 'Done', 'commit' => 'aaaaaaa']]);
    // a code run that ran meanwhile is not taken: a commit names the culprit
    AgentWorld::run($this->agent, $other, RunType::Task, ['status' => RunStatus::Succeeded, 'started_at' => now()->subMinutes(20), 'finished_at' => now()->subMinutes(10), 'result' => ['commit' => 'bbbbbbb']]);

    $this->travel(30)->minutes();
    expect(DetectUnauthorizedPush::run(Actor::system(User::defaultBot(), 'test'), FakeGitHub::push($sha)))->toBe('foreign')
        ->and($this->link->fresh()->guard_runs)->toBe([['run_id' => $culprit->id, 'item_id' => $item->id, 'bot_id' => $this->agent->id]])
        ->and(Comment::query()->where('work_item_id', $item->id)->exists())->toBeTrue()
        ->and(Comment::query()->where('work_item_id', $other->id)->exists())->toBeFalse();
});

it('takes a run by a commit the push brought besides the one it ended at', function () {
    $item = WorkItem::factory()->create(['project_id' => $this->project->id]);
    $culprit = AgentWorld::run($this->agent, $item, RunType::Correction, ['status' => RunStatus::Succeeded, 'started_at' => now()->subHours(2), 'finished_at' => now()->subHours(2), 'result' => ['commit' => 'cccccccccccc']]);
    $push = FakeGitHub::push(str_repeat('d', 40));
    $push['commits'][] = ['id' => str_repeat('c', 40), 'message' => 'Fix'];

    DetectUnauthorizedPush::run(Actor::system(User::defaultBot(), 'test'), $push);
    expect(array_column($this->link->fresh()->guard_runs, 'run_id'))->toBe([$culprit->id]);
});

it('takes every code run of the token time when no commit names one, and says it at each item', function () {
    [$runner] = AgentWorld::runner();
    $first = AgentWorld::run($this->agent, $this->project, RunType::Task, ['status' => RunStatus::Running, 'runner_id' => $runner->id, 'started_at' => now()->subMinutes(5)]);
    $second = AgentWorld::run($this->agent, $this->project, RunType::Conflict, ['status' => RunStatus::Succeeded, 'started_at' => now()->subMinutes(40), 'finished_at' => now()->subMinutes(30), 'result' => ['summary' => 'No commit']]);
    // a run of the same item: one comment there
    $again = AgentWorld::run($this->agent, $second->workItem, RunType::Task, ['status' => RunStatus::Failed, 'started_at' => now()->subMinutes(50), 'finished_at' => now()->subMinutes(45)]);
    // outside the token time, never started, not a code run, another project: not taken
    AgentWorld::run($this->agent, $this->project, RunType::Task, ['status' => RunStatus::Succeeded, 'started_at' => now()->subHours(3), 'finished_at' => now()->subMinutes(DetectUnauthorizedPush::TOKEN_MINUTES + 1)]);
    AgentWorld::run($this->agent, $this->project, RunType::Task, ['status' => RunStatus::Canceled, 'finished_at' => now()->subMinutes(5)]);
    AgentWorld::run($this->agent, $this->project, RunType::Review, ['status' => RunStatus::Succeeded, 'started_at' => now()->subMinutes(5), 'finished_at' => now()->subMinutes(2)]);
    AgentWorld::run($this->agent, Project::factory()->create(), RunType::Task, ['status' => RunStatus::Running, 'runner_id' => $runner->id, 'started_at' => now()]);

    expect(DetectUnauthorizedPush::run(Actor::system(User::defaultBot(), 'test'), FakeGitHub::push(str_repeat('f', 40))))->toBe('foreign')
        ->and(array_column($this->link->fresh()->guard_runs, 'run_id'))->toBe([$first->id, $second->id, $again->id])
        ->and(Comment::query()->pluck('work_item_id')->sort()->values()->all())->toBe(collect([$first->work_item_id, $second->work_item_id])->sort()->values()->all());
});

it('guards without any run and tells the org admins, and in a project being deleted not at all', function () {
    consumers(NotificationConsumer::class);
    config(['mail.default' => 'smtp']);
    Mail::fake();
    Queue::fake([SendNotificationMailJob::class]);
    $member = memberOf($this->project, ProjectRole::Admin);

    expect(DetectUnauthorizedPush::run(Actor::system(User::defaultBot(), 'test'), FakeGitHub::push(str_repeat('f', 40))))->toBe('foreign')
        ->and($this->link->fresh()->guard_runs)->toBe([])
        ->and(Comment::query()->exists())->toBeFalse();

    // the org admins hear of it every time, without an item, with a mail of its own; an admin of the project does not
    $notification = Notification::query()->where('user_id', $this->admin->id)->sole();
    expect([$notification->kind, $notification->work_item_id, $notification->project_id, $notification->inbox])->toBe([NotificationKind::MergeGuardDetected, null, $this->project->id, true])
        ->and($notification->data)->toBe(['sha' => str_repeat('f', 40), 'branch' => 'main', 'deleted' => false, 'item_ids' => []])
        ->and(Notification::query()->where('user_id', $member->id)->exists())->toBeFalse()
        ->and(NotificationMail::query()->where('user_id', $this->admin->id)->sole()->scope)->toBe("guard:{$this->project->id}");

    SendNotificationMail::run(Actor::system(User::defaultBot(), 'test'), NotificationMail::query()->where('user_id', $this->admin->id)->sole()->id);
    Mail::assertSent(NotificationDigest::class, fn (NotificationDigest $mail) => $mail->hasTo($this->admin->email)
        && str_contains($mail->render(), 'fffffff') && str_contains($mail->render(), '/projects/WEB/settings')
        && $mail->envelope()->subject === __('mail.notifications.guard.subject', ['identifier' => 'WEB']));

    $deleting = Project::factory()->create(['deleting_at' => now()]);
    $repository = GitHubRepository::factory()->create(['installation_id' => GitHubInstallation::query()->value('id'), 'github_id' => 700_000_005, 'full_name' => 'feldwerk/gone']);
    ProjectRepository::factory()->create(['project_id' => $deleting->id, 'repository_id' => $repository->id]);
    expect(DetectUnauthorizedPush::run(Actor::system(User::defaultBot(), 'test'), FakeGitHub::push(str_repeat('f', 40), repositoryId: 700_000_005, fullName: 'feldwerk/gone')))->toBe('foreign')
        ->and(ProjectRepository::query()->where('project_id', $deleting->id)->sole()->guarded())->toBeFalse();
});

it('takes the notification of a guard from an org admin who is one no longer, inbox and mail', function () {
    consumers(NotificationConsumer::class);
    config(['mail.default' => 'smtp']);
    Mail::fake();
    Queue::fake([SendNotificationMailJob::class]);
    // a member of the project, so the project alone would still let them see it
    $this->project->update(['visibility' => 'private']);
    app(RoleAssignments::class)->setProjectRole($this->admin, $this->project, ProjectRole::Member);
    DetectUnauthorizedPush::run(Actor::system(User::defaultBot(), 'test'), FakeGitHub::push(str_repeat('f', 40)));
    $notification = Notification::query()->where('user_id', $this->admin->id)->sole();
    expect(Notification::query()->inboxOf($this->admin)->count())->toBe(1);

    app(RoleAssignments::class)->setOrgRole($this->admin, OrgRole::Member);
    Visibility::forget();
    expect(Notification::query()->inboxOf($this->admin)->count())->toBe(0)
        ->and(Notification::query()->whereKey($notification->id)->visibleTo($this->admin)->exists())->toBeFalse()
        // other notifications of the project stay
        ->and(Notification::factory()->for($this->admin)->create(['project_id' => $this->project->id])->newQuery()->inboxOf($this->admin)->count())->toBe(1)
        ->and(SendNotificationMail::run(Actor::system(User::defaultBot(), 'test'), NotificationMail::query()->where('user_id', $this->admin->id)->sole()->id))->toBe(NotificationMail::SKIPPED);
    Mail::assertNothingSent();
});

it('sends no mail of a guard that an admin confirmed meanwhile', function () {
    consumers(NotificationConsumer::class);
    config(['mail.default' => 'smtp']);
    Mail::fake();
    Queue::fake([SendNotificationMailJob::class]);
    DetectUnauthorizedPush::run(Actor::system(User::defaultBot(), 'test'), FakeGitHub::push(str_repeat('f', 40)));
    ConfirmMergeGuard::run(Actor::system($this->admin, 'test'), $this->project);

    expect(SendNotificationMail::run(Actor::system(User::defaultBot(), 'test'), NotificationMail::query()->where('user_id', $this->admin->id)->sole()->id))->toBe(NotificationMail::SKIPPED);
    Mail::assertNothingSent();
});

it('tells nobody of a guard whose project is being deleted when it is consumed', function () {
    DetectUnauthorizedPush::run(Actor::system(User::defaultBot(), 'test'), FakeGitHub::push(str_repeat('f', 40)));
    $this->project->forceFill(['deleting_at' => now()])->save();

    expect(NotifyRecipients::run(Actor::system(User::defaultBot(), 'test'), eventsOf(EventType::ProjectMergeGuardDetected)->sole()))->toBe(0)
        ->and(Notification::query()->exists())->toBeFalse();
});

it('counts the app deleting the base branch', function () {
    $item = WorkItem::factory()->create(['project_id' => $this->project->id]);
    $culprit = AgentWorld::run($this->agent, $item, RunType::Task, ['status' => RunStatus::Succeeded, 'started_at' => now()->subMinutes(10), 'finished_at' => now()->subMinutes(5)]);
    $sha = str_repeat('9', 40);
    $push = [...FakeGitHub::push(str_repeat('0', 40)), 'before' => $sha, 'deleted' => true, 'commits' => [], 'head_commit' => null];
    // werkbuch never deletes a base branch: not even a merge of its own explains it
    OwnMerges::merged(OwnMerges::expect($this->link->repository_id, 3), $sha);

    expect(DetectUnauthorizedPush::run(Actor::system(User::defaultBot(), 'test'), $push))->toBe('foreign')
        ->and([$this->link->fresh()->guard_sha, array_column($this->link->fresh()->guard_runs, 'run_id')])->toBe([$sha, [$culprit->id]])
        ->and(eventsOf(EventType::ProjectMergeGuardDetected)->sole()->meta['deleted'])->toBeTrue()
        ->and(Comment::query()->where('work_item_id', $item->id)->sole()->body_text)->toContain(__('github.guard.comment_deleted', ['branch' => 'main', 'sha' => '9999999', 'project' => 'WEB', 'run' => __('github.guard.run.task')]));
});

it('compares the base branch again under the lock', function () {
    // the base branch changes between reading the link and locking it
    $this->link->forceFill(['base_branch' => 'main'])->save();
    $changed = false;
    DB::connection()->beforeExecuting(function (string $sql) use (&$changed) {
        if (! $changed && str_starts_with($sql, 'select * from `project_repositories`') && str_contains($sql, 'for update')) {
            $changed = true;
            DB::table('project_repositories')->update(['base_branch' => 'develop']);
        }
    });

    expect(DetectUnauthorizedPush::run(Actor::system(User::defaultBot(), 'test'), FakeGitHub::push(str_repeat('a', 40))))->toBe('foreign')
        ->and($this->link->fresh()->guarded())->toBeFalse()
        ->and(eventsOf(EventType::ProjectMergeGuardDetected))->toHaveCount(0);
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
