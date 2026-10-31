<?php

use App\Access\ProjectRole;
use App\Access\Visibility;
use App\Actions\Projects\CreateProject;
use App\Actions\Projects\DeleteProject;
use App\Actions\Projects\PurgeProject as PurgeProjectAction;
use App\Actions\Projects\UpdateProject;
use App\Events\EventType;
use App\Exceptions\Problem;
use App\Jobs\PurgeProject;
use App\Models\Event;
use App\Models\Favorite;
use App\Models\Project;
use App\Models\ProjectIdentifier;
use App\Models\ProjectMember;
use App\Models\User;
use Illuminate\Database\Eloquent\ModelNotFoundException;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Queue;
use Illuminate\Support\Facades\Storage;
use Spatie\MediaLibrary\MediaCollections\Models\Media;

beforeEach(function () {
    Storage::fake('local');
});

/**
 * A project WEB with a former identifier, a picture, a member and a favorite.
 *
 * @return array{Project, User, User}
 */
function projectToDelete(): array
{
    $admin = User::factory()->create();
    $web = CreateProject::run(actor($admin), ['name' => 'Website', 'identifier' => 'SITE', 'image_url' => imageDataUrl()]);
    UpdateProject::run(actor($admin), $web, ['identifier' => 'WEB']);
    $member = memberOf($web, ProjectRole::Member);
    Favorite::factory()->create(['user_id' => $member->id, 'favoritable_type' => $web->getMorphClass(), 'favoritable_id' => $web->id]);

    return [$web->fresh() ?? throw new RuntimeException('gone'), $admin, $member];
}

it('accepts the deletion and hides the project from everybody at once', function () {
    Queue::fake();
    [$web, $admin, $member] = projectToDelete();
    $orgAdmin = User::factory()->admin()->create();
    // the visible projects are kept for the request, and in a test across calls (P33)
    $this->actingAs($member)->getJson('/api/v1/projects')->assertJsonPath('meta.total', 1);
    $this->actingAs($orgAdmin)->getJson('/api/v1/projects')->assertJsonPath('meta.total', 1);

    $this->actingAs($admin)->deleteJson('/api/v1/projects/WEB')->assertStatus(202)->assertNoContent(202);

    foreach ([$admin, $member, $orgAdmin, User::defaultBot()] as $account) {
        $this->actingAs($account)->getJson('/api/v1/projects/WEB')->assertNotFound();
        $this->getJson('/api/v1/projects?include_archived=1')->assertJsonPath('meta.total', 0);
    }

    expect($web->fresh()?->deleting_at)->not->toBeNull()
        ->and(Visibility::projectIds($orgAdmin)->all())->toBe([]);
    Queue::assertPushedOn('bulk', PurgeProject::class, fn (PurgeProject $job) => $job->projectId === $web->id && $job->actorId === $admin->id);
});

it('purges the project and everything that hangs on it, keeping its events', function () {
    [$web, $admin] = projectToDelete();
    $image = Media::query()->sole();
    $other = CreateProject::run(actor($admin), ['name' => 'Andere', 'identifier' => 'APP']);

    // the queue runs synchronously: the purge follows the commit
    $this->actingAs($admin)->deleteJson('/api/v1/projects/WEB')->assertStatus(202);

    expect(Project::query()->find($web->id))->toBeNull()
        ->and(ProjectMember::query()->where('project_id', $web->id)->count())->toBe(0)
        ->and(DB::table('model_has_roles')->where('team_id', $web->id)->count())->toBe(0)
        ->and(Favorite::query()->where('favoritable_id', $web->id)->count())->toBe(0)
        ->and(ProjectIdentifier::query()->where('project_id', $web->id)->count())->toBe(0)
        ->and(Media::query()->count())->toBe(0)
        ->and(Storage::disk('local')->exists($image->getPathRelativeToRoot()))->toBeFalse()
        // the other project keeps its own
        ->and(Visibility::roleIn($admin, $other))->toBe(ProjectRole::Admin);

    $deleted = Event::query()->where('type', EventType::ProjectDeleted)->sole();
    expect($deleted->project_id)->toBe($web->id)
        ->and($deleted->actor_id)->toBe($admin->id)
        ->and($deleted->meta)->toMatchArray(['identifier' => 'WEB', 'name' => 'Website'])
        ->and(Event::query()->where('project_id', $web->id)->count())->toBeGreaterThan(1);
});

it('lets only admins of the project delete it', function () {
    Queue::fake();
    [$web, , $member] = projectToDelete();

    $this->actingAs($member)->deleteJson('/api/v1/projects/WEB')
        ->assertForbidden()->assertJsonPath('detail', __('problem.detail.project_delete_admins'));

    expect($web->fresh()?->deleting_at)->toBeNull();
    Queue::assertNotPushed(PurgeProject::class);
});

it('answers a second deletion with 404', function () {
    Queue::fake();
    [, $admin] = projectToDelete();

    $this->actingAs($admin)->deleteJson('/api/v1/projects/WEB')->assertStatus(202);
    $this->deleteJson('/api/v1/projects/WEB')->assertNotFound();

    Queue::assertPushed(PurgeProject::class, 1);
});

it('records a deletion only once, also when a second one comes with the project read before', function () {
    Queue::fake();
    [$web, $admin] = projectToDelete();
    // read before the first deletion, as by a request that runs at the same time
    $stale = Project::query()->findOrFail($web->id);

    DeleteProject::run(actor($admin), $web);

    expect(fn () => DeleteProject::run(actor($admin), $stale))->toThrow(fn (Problem $problem) => expect($problem->status)->toBe(404))
        ->and(Event::query()->where('type', EventType::ProjectDeleted)->count())->toBe(1);
    Queue::assertPushed(PurgeProject::class, 1);
});

it('answers 404 for a project purged after it was read, with no event and no job', function () {
    Queue::fake();
    [$web, $admin] = projectToDelete();
    $stale = Project::query()->findOrFail($web->id);
    // the rights were read before the purge, as by a request that runs at the same time
    expect(Visibility::projectIds($admin)->all())->toContain($web->id);
    DB::table('projects')->where('id', $web->id)->delete();

    // ModelNotFoundException: the API answers it with 404
    expect(fn () => DeleteProject::run(actor($admin), $stale))->toThrow(ModelNotFoundException::class)
        ->and(Event::query()->where('type', EventType::ProjectDeleted)->count())->toBe(0);
    Queue::assertNotPushed(PurgeProject::class);
});

it('leaves nothing to do for a job whose project is gone already', function () {
    [$web, $admin] = projectToDelete();
    $job = new PurgeProject($web->id, $admin->id);
    $web->update(['deleting_at' => now()]);

    $job->handle();
    $job->handle();

    expect(Project::query()->find($web->id))->toBeNull();
});

it('purges only a project that is being deleted', function () {
    [$web] = projectToDelete();

    expect(fn () => PurgeProjectAction::run(actor(User::defaultBot()), $web))->toThrow(LogicException::class, 'not being deleted')
        ->and($web->fresh())->not->toBeNull();
});
