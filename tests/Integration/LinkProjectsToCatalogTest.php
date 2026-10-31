<?php

use App\Actions\Setup\LinkProjectsToCatalog;
use App\Events\EventType;
use App\Models\Event;
use App\Models\Project;
use App\Models\ProjectType;
use App\Models\User;
use App\Models\Workflow;
use App\Models\WorkItemType;
use Illuminate\Database\QueryException;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;

/*
 * The migration 2026_10_31_000720_link_projects_to_catalog on a database with a project of Phase 2: no workflow, no
 * types. It runs on the migrations of the test (DatabaseMigrations), rolled back to just before it.
 */

const LINK_MIGRATION = 'database/migrations/2026_10_31_000720_link_projects_to_catalog.php';

it('links every project of phase 2 to the default workflow and the active types', function () {
    // exactly this migration, also when later phases add newer ones: the columns are nullable again
    $this->artisan('migrate:rollback', ['--path' => LINK_MIGRATION])->assertSuccessful();

    $lead = User::factory()->create();
    $id = strtolower((string) Str::ulid());
    // the factory would switch types on: a row as Phase 2 left it
    DB::table('projects')->insert([
        'id' => $id, 'identifier' => 'WEB', 'name' => 'Website', 'description' => '', 'lead_id' => $lead->id,
        'visibility' => 'public', 'next_number' => 0, 'created_at' => now(), 'updated_at' => now(),
    ]);

    $this->artisan('migrate')->assertSuccessful();

    $web = Project::query()->findOrFail($id);
    $types = WorkItemType::query()->orderBy('id')->get()->keyBy('name')->map(fn (WorkItemType $type) => $type->id);
    $event = Event::query()->where('type', EventType::ProjectUpdated)->sole();

    expect($web)->workflow_id->toBe(Workflow::default()->id)->default_type_id->toBe($types['Task'])
        ->and(ProjectType::query()->where('project_id', $id)->orderBy('type_id')->pluck('type_id')->all())->toBe([$types['Task'], $types['Bug'], $types['Epic']])
        ->and($event->subject_id)->toBe($id)
        ->and($event->project_id)->toBe($id)
        ->and($event->actor_id)->toBe(User::defaultBot()->id)
        ->and($event->meta)->toBe(['via' => 'system', 'reason' => 'setup'])
        ->and($event->changes)->toBe([
            'workflow_id' => ['old' => null, 'new' => Workflow::default()->id],
            'enabled_type_ids' => ['old' => [], 'new' => [$types['Task'], $types['Bug'], $types['Epic']]],
            'default_type_id' => ['old' => null, 'new' => $types['Task']],
        ]);

    // a second run finds nothing to do
    $before = [Event::query()->count(), ProjectType::query()->count(), $web->fresh()?->updated_at];
    LinkProjectsToCatalog::run();

    expect([Event::query()->count(), ProjectType::query()->count(), $web->fresh()?->updated_at])->toEqual($before)
        // the workflow and the default type stay while a project uses them: foreign keys now
        ->and(fn () => Workflow::default()->delete())->toThrow(QueryException::class)
        ->and(fn () => WorkItemType::query()->whereKey($types['Task'])->delete())->toThrow(QueryException::class);
});

/** A project row as Phase 2 left it, with the types given switched on. */
$phaseTwoProject = function (string $identifier, array $types = []): string {
    $id = strtolower((string) Str::ulid());
    DB::table('projects')->insert([
        'id' => $id, 'identifier' => $identifier, 'name' => $identifier, 'description' => '', 'lead_id' => User::factory()->create()->id,
        'visibility' => 'public', 'next_number' => 0, 'created_at' => now(), 'updated_at' => now(),
    ]);

    foreach ($types as $type) {
        DB::table('project_types')->insert(['id' => strtolower((string) Str::ulid()), 'project_id' => $id, 'type_id' => $type, 'created_at' => now(), 'updated_at' => now()]);
    }

    return $id;
};

it('never makes an archived type the default of a project', function () use ($phaseTwoProject) {
    $this->artisan('migrate:rollback', ['--path' => LINK_MIGRATION])->assertSuccessful();
    $types = WorkItemType::query()->orderBy('id')->pluck('id', 'name');
    WorkItemType::query()->whereKey($types['Task'])->update(['archived_at' => now()]);
    // switched on: the archived Task first in catalog order, then Bug
    $id = $phaseTwoProject('WEB', [$types['Task'], $types['Bug']]);

    LinkProjectsToCatalog::run();

    expect(Project::query()->findOrFail($id)->default_type_id)->toBe($types['Bug']);
});

it('stops with a clear error when a project would get no active default type', function () use ($phaseTwoProject) {
    $this->artisan('migrate:rollback', ['--path' => LINK_MIGRATION])->assertSuccessful();
    $phaseTwoProject('WEB');
    WorkItemType::query()->update(['archived_at' => now()]);

    expect(fn () => LinkProjectsToCatalog::run())->toThrow(RuntimeException::class, 'Project WEB needs a default type, but none of its types is active')
        ->and(Event::query()->where('type', EventType::ProjectUpdated)->exists())->toBeFalse();
});
