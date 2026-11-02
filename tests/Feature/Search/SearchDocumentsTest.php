<?php

use App\Access\ProjectRole;
use App\Actions\Projects\UpdateProject;
use App\Actions\WorkItems\CreateWorkItem;
use App\Actions\WorkItems\DeleteWorkItem;
use App\Actions\WorkItems\UpdateWorkItem;
use App\Models\Comment;
use App\Models\Label;
use App\Models\Project;
use App\Models\User;
use App\Models\WorkItem;
use App\Search\SearchIndexer;
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
        'comments' => '',
        'type_id' => $web->default_type_id,
        'state_category' => 'backlog',
        'assignee_id' => $mara->id,
        'label_ids' => [$first->id, $second->id],
        'archived' => false,
        'updated_at' => $item->updated_at?->getTimestamp(),
    ])
        ->and(WorkItem::query()->findOrFail($archived->id)->toSearchableArray())
        ->toMatchArray(['key' => 'WEB-2', 'description' => '', 'comments' => '', 'assignee_id' => null, 'label_ids' => [], 'archived' => true, 'state_category' => 'completed']);
});

it('puts the text of the comments into the item\'s document, cut at 64 KB', function () use ($web) {
    [$web, $mara] = $web();
    $item = WorkItem::factory()->for($web)->create();
    $comment = fn (WorkItem $on, string $text, string $at) => Comment::factory()->for($on, 'workItem')
        ->create(['author_id' => $mara->id, 'body_text' => $text, 'created_at' => $at]);
    // written in another order than they were made: the document follows the time of the comments
    $comment($item, "Bitte auch\ndas Impressum", '2026-10-28 10:00:00');
    $comment($item, 'Zuerst die Pflichtfelder', '2026-10-27 09:00:00');
    $comment($item, 'Erledigt', '2026-10-29 08:00:00');

    // the cut falls into the two bytes of the ä: the document ends before it, never with half a character
    $long = WorkItem::factory()->for($web)->create();
    $comment($long, str_repeat('a', SearchIndexer::COMMENTS_MAX - 6), '2026-10-27 09:00:00');
    $comment($long, 'bbbbä und mehr', '2026-10-28 09:00:00');

    $document = fn (WorkItem $of): string => WorkItem::query()->findOrFail($of->id)->toSearchableArray()['comments'];

    expect(SearchIndexer::COMMENTS_MAX)->toBe(65536)
        ->and($document($item))->toBe("Zuerst die Pflichtfelder\nBitte auch\ndas Impressum\nErledigt")
        ->and($document($long))->toBe(str_repeat('a', SearchIndexer::COMMENTS_MAX - 6)."\nbbbb")
        ->and(strlen($document($long)))->toBe(SearchIndexer::COMMENTS_MAX - 1);
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
    WorkItem::factory()->count(3)->for($web)->create()->each(function (WorkItem $item) use ($label, $mara): void {
        $item->labels()->attach($label->id);
        Comment::factory()->for($item, 'workItem')->create(['author_id' => $mara->id, 'body_text' => "Notiz zu {$item->number}"]);
    });

    $items = WorkItem::makeAllSearchableQuery()->get();
    $projects = Project::makeAllSearchableQuery()->get();
    DB::enableQueryLog();
    $documents = [...$items->map->toSearchableArray(), ...$projects->map->toSearchableArray()];

    expect(DB::getQueryLog())->toBe([])
        ->and(array_column($documents, 'key'))->toBe(['WWW-1', 'WWW-2', 'WWW-3'])
        ->and(array_column($documents, 'comments'))->toBe(['Notiz zu 1', 'Notiz zu 2', 'Notiz zu 3'])
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
