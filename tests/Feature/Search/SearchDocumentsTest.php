<?php

use App\Access\ProjectRole;
use App\Actions\Projects\UpdateProject;
use App\Actions\WorkItems\CreateWorkItem;
use App\Actions\WorkItems\DeleteWorkItem;
use App\Actions\WorkItems\UpdateWorkItem;
use App\Models\Label;
use App\Models\Project;
use App\Models\User;
use App\Models\WorkItem;
use Illuminate\Support\Facades\DB;

/** WEB with Mara as its admin. */
$web = function (): array {
    $mara = User::factory()->create(['name' => 'Mara']);
    $web = Project::factory()->identifier('WEB')->member($mara, ProjectRole::Admin)->create(['lead_id' => $mara->id]);

    return [$web, $mara];
};

it('names the indexes with the prefix', function () {
    expect((new WorkItem)->searchableAs())->toBe('testing_work_items')
        ->and((new Project)->searchableAs())->toBe('testing_projects')
        ->and((new User)->searchableAs())->toBe('testing_users');
});

it('builds the document of an item', function () use ($web) {
    searchEngine();
    [$web, $mara] = $web();
    [$first, $second] = [Label::factory()->create(), Label::factory()->create()];
    $created = CreateWorkItem::run(actor($mara), [
        'project_id' => $web->id,
        'title' => 'Kontaktformular prüfen',
        'description' => "Das **Formular** sendet\n\nan den Vertrieb",
        'assignee_id' => $mara->id,
        'label_ids' => [$second->id, $first->id],
    ]);
    $item = WorkItem::query()->findOrFail($created->id);
    $archived = WorkItem::factory()->archived()->for($web)->create();

    expect($item->toSearchableArray())->toBe([
        'id' => $item->id,
        'project_id' => $web->id,
        'key' => 'WEB-1',
        'number' => 1,
        'title' => 'Kontaktformular prüfen',
        'description' => "Das Formular sendet\nan den Vertrieb",
        'type_id' => $web->default_type_id,
        'state_category' => 'backlog',
        'assignee_id' => $mara->id,
        'label_ids' => [$first->id, $second->id],
        'archived' => false,
        'updated_at' => $item->updated_at?->getTimestamp(),
    ])
        ->and(WorkItem::query()->findOrFail($archived->id)->toSearchableArray())
        ->toMatchArray(['key' => 'WEB-2', 'description' => '', 'assignee_id' => null, 'label_ids' => [], 'archived' => true, 'state_category' => 'completed']);
});

it('builds the document of a project with its former identifiers', function () use ($web) {
    [$web, $mara] = $web();
    $web->update(['description' => 'Die Website von Feldwerk']);
    UpdateProject::run(actor($mara), $web, ['identifier' => 'WWW']);
    UpdateProject::run(actor($mara), $web, ['identifier' => 'NET']);
    $archived = Project::factory()->archived()->create(['description' => '']);

    expect(Project::query()->findOrFail($web->id)->toSearchableArray())->toBe([
        'id' => $web->id,
        'identifier' => 'NET',
        'former_identifiers' => ['WEB', 'WWW'],
        'name' => $web->name,
        'description' => 'Die Website von Feldwerk',
        'archived' => false,
    ])
        ->and(Project::query()->findOrFail($archived->id)->toSearchableArray())
        ->toMatchArray(['former_identifiers' => [], 'description' => '', 'archived' => true]);
});

it('builds the document of a person and of a bot', function () {
    $lene = User::factory()->disabled()->create(['name' => 'Lene Lind', 'handle' => 'lene']);
    $kira = User::factory()->bot()->create(['name' => 'Kira', 'handle' => 'kira']);

    expect($lene->toSearchableArray())->toBe(['id' => $lene->id, 'name' => 'Lene Lind', 'handle' => 'lene', 'type' => 'person', 'disabled' => true])
        ->and($kira->toSearchableArray())->toBe(['id' => $kira->id, 'name' => 'Kira', 'handle' => 'kira', 'type' => 'bot', 'disabled' => false]);
});

it('leaves a project being deleted out', function () {
    expect(Project::factory()->create()->shouldBeSearchable())->toBeTrue()
        ->and(Project::factory()->create(['deleting_at' => now()])->shouldBeSearchable())->toBeFalse();
});

it('loads what the documents read with the query of a rebuild', function () use ($web) {
    [$web, $mara] = $web();
    UpdateProject::run(actor($mara), $web, ['identifier' => 'WWW']);
    $label = Label::factory()->create();
    WorkItem::factory()->count(3)->for($web)->create()->each(fn (WorkItem $item) => $item->labels()->attach($label->id));

    $items = WorkItem::makeAllSearchableQuery()->get();
    $projects = Project::makeAllSearchableQuery()->get();
    DB::enableQueryLog();
    $documents = [...$items->map->toSearchableArray(), ...$projects->map->toSearchableArray()];

    expect(DB::getQueryLog())->toBe([])
        ->and(array_column($documents, 'key'))->toBe(['WWW-1', 'WWW-2', 'WWW-3'])
        ->and(array_column($documents, 'former_identifiers'))->toBe([['WEB']]);
});

it('never writes the index when a model is saved', function () use ($web) {
    $engine = searchEngine();
    consumers();
    [$web, $mara] = $web();

    $item = CreateWorkItem::run(actor($mara), ['project_id' => $web->id, 'title' => 'Kontaktformular']);
    UpdateWorkItem::run(actor($mara), $item, ['title' => 'Kontaktformular prüfen']);
    DeleteWorkItem::run(actor($mara), WorkItem::query()->findOrFail($item->id));
    UpdateProject::run(actor($mara), $web, ['name' => 'Website']);
    $mara->update(['name' => 'Mara Maier']);

    expect($engine->documents('testing_work_items'))->toBe([])
        ->and($engine->documents('testing_projects'))->toBe([])
        ->and($engine->documents('testing_users'))->toBe([])
        ->and($engine->writes())->toBe(0);
});
