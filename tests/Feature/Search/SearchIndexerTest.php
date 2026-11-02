<?php

use App\Access\ProjectRole;
use App\Actions\Projects\DeleteProject;
use App\Jobs\ReindexWorkItems;
use App\Models\Project;
use App\Models\User;
use App\Models\WorkItem;
use App\Search\SearchIndexer;
use Illuminate\Support\Facades\DB;
use Laravel\Scout\EngineManager;
use Laravel\Scout\Engines\NullEngine;

/** WEB with two items and OPS with one, Mara admin of WEB. */
$world = function (): array {
    $mara = User::factory()->create(['name' => 'Mara']);
    $web = Project::factory()->identifier('WEB')->member($mara, ProjectRole::Admin)->create(['lead_id' => $mara->id]);
    $ops = Project::factory()->identifier('OPS')->create();
    $inWeb = WorkItem::factory()->for($web)->count(2)->create();
    $inOps = WorkItem::factory()->for($ops)->create();

    return [$web, $ops, $inWeb, $inOps, $mara];
};

/** The titles of the item documents by id. */
$titles = fn ($engine): array => array_map(fn (array $document) => $document['title'], $engine->documents('testing_work_items'));

it('upserts an item from the database and removes it once it is gone', function () use ($world) {
    $engine = searchEngine();
    [, , [$item]] = $world();
    $indexer = app(SearchIndexer::class);

    $indexer->upsertItem($item->id);
    DB::table('work_items')->where('id', $item->id)->update(['title' => 'Kontaktformular prüfen']);
    $indexer->upsertItem($item->id);

    expect(array_keys($engine->documents('testing_work_items')))->toBe([$item->id])
        ->and($engine->documents('testing_work_items')[$item->id])->toMatchArray(['title' => 'Kontaktformular prüfen', 'key' => 'WEB-1']);

    DB::table('work_items')->where('id', $item->id)->delete();
    $indexer->upsertItem($item->id);

    expect($engine->documents('testing_work_items'))->toBe([]);
});

it('removes an item by its id', function () use ($world) {
    $engine = searchEngine();
    [, , [$item, $other]] = $world();
    $indexer = app(SearchIndexer::class);
    $indexer->upsertItem($item->id);
    $indexer->upsertItem($other->id);

    $indexer->removeItem($item->id);

    expect(array_keys($engine->documents('testing_work_items')))->toBe([$other->id]);
});

it('upserts a project and an account', function () use ($world) {
    $engine = searchEngine();
    [$web, , , , $mara] = $world();
    $indexer = app(SearchIndexer::class);
    $indexer->upsertProject($web->id);
    $indexer->upsertUser($mara->id);

    DB::table('projects')->where('id', $web->id)->update(['name' => 'Website neu']);
    DB::table('users')->where('id', $mara->id)->update(['name' => 'Mara Lindqvist']);
    $indexer->upsertProject($web->id);
    $indexer->upsertUser($mara->id);
    $indexer->upsertUser('01jzzzzzzzzzzzzzzzzzzzzzzz');

    expect($engine->documents('testing_projects'))->toHaveCount(1)
        ->and($engine->documents('testing_projects')[$web->id])->toMatchArray(['name' => 'Website neu', 'identifier' => 'WEB'])
        ->and($engine->documents('testing_users'))->toHaveCount(1)
        ->and($engine->documents('testing_users')[$mara->id])->toMatchArray(['name' => 'Mara Lindqvist']);
});

it('removes a project and every document of its items, also when the rows are gone', function () use ($world) {
    $engine = searchEngine();
    [$web, $ops, , $inOps, $mara] = $world();
    $indexer = app(SearchIndexer::class);
    $indexer->rebuild();

    DeleteProject::run(actor($mara), $web);
    expect(Project::query()->find($web->id))->toBeNull(); // the purge ran (K10)

    $indexer->removeProject($web->id);

    expect(array_keys($engine->documents('testing_projects')))->toBe([$ops->id])
        ->and(array_keys($engine->documents('testing_work_items')))->toBe([$inOps->id]);
});

it('removes a project being deleted instead of updating it', function () use ($world) {
    $engine = searchEngine();
    [$web, $ops, $inWeb] = $world();
    $indexer = app(SearchIndexer::class);
    $indexer->rebuild();

    DB::table('projects')->where('id', $web->id)->update(['deleting_at' => now(), 'name' => 'Website neu']);
    $indexer->upsertProject($web->id);
    $indexer->upsertProject('01jzzzzzzzzzzzzzzzzzzzzzzz');

    // only the project's own document: its items go with removeProject()
    expect(array_keys($engine->documents('testing_projects')))->toBe([$ops->id])
        ->and($engine->documents('testing_work_items'))->toHaveKeys([$inWeb[0]->id, $inWeb[1]->id]);
});

it('reindexes the items of the projects named, or of all', function () use ($world, $titles) {
    $engine = searchEngine();
    [$web, , $inWeb, $inOps] = $world();
    $indexer = app(SearchIndexer::class);
    $indexer->rebuild();
    DB::table('work_items')->update(['title' => 'Neu']);

    $indexer->reindexItems([$web->id]);

    expect($titles($engine))->toMatchArray([$inWeb[0]->id => 'Neu', $inWeb[1]->id => 'Neu'])
        ->and($titles($engine)[$inOps->id])->not->toBe('Neu');

    $indexer->reindexItems(null);

    expect(array_unique(array_values($titles($engine))))->toBe(['Neu']);
});

it('reindexes through a job on the queue search', function () use ($world, $titles) {
    $engine = searchEngine();
    [$web, , $inWeb, $inOps] = $world();
    DB::table('work_items')->update(['title' => 'Neu']);

    dispatch(new ReindexWorkItems([$web->id]));

    expect((new ReindexWorkItems(null))->queue)->toBe('search')
        ->and(array_keys($titles($engine)))->toEqualCanonicalizing([$inWeb[0]->id, $inWeb[1]->id])
        ->and($titles($engine))->not->toHaveKey($inOps->id);
});

it('leaves the items of a project being deleted out of a reindex and a rebuild', function () use ($world) {
    $engine = searchEngine();
    [$web, $ops, $inWeb, $inOps] = $world();
    $indexer = app(SearchIndexer::class);
    $indexer->rebuild();

    DB::table('projects')->where('id', $web->id)->update(['deleting_at' => now()]);
    $indexer->upsertItem($inWeb[0]->id);

    expect(array_keys($engine->documents('testing_work_items')))->toEqualCanonicalizing([$inWeb[1]->id, $inOps->id]);

    $indexer->removeItem($inWeb[1]->id);
    $indexer->reindexItems(null);
    $indexer->reindexItems([$web->id]);

    expect(array_keys($engine->documents('testing_work_items')))->toBe([$inOps->id]);

    $counts = $indexer->rebuild();

    expect(array_keys($engine->documents('testing_work_items')))->toBe([$inOps->id])
        ->and(array_keys($engine->documents('testing_projects')))->toBe([$ops->id])
        ->and($counts)->toMatchArray(['work_items' => 1, 'projects' => 1]);
});

it('rebuilds every index from scratch', function () use ($world) {
    $engine = searchEngine();
    [$web, $ops, $inWeb, $inOps] = $world();
    $indexer = app(SearchIndexer::class);
    $indexer->rebuild();
    DB::table('work_items')->where('id', $inWeb[0]->id)->delete();

    $counts = $indexer->rebuild();

    expect(array_keys($engine->documents('testing_work_items')))->toEqualCanonicalizing([$inWeb[1]->id, $inOps->id])
        ->and(array_keys($engine->documents('testing_projects')))->toEqualCanonicalizing([$web->id, $ops->id])
        ->and(count($engine->documents('testing_users')))->toBe(User::count())
        ->and($counts)->toBe(['work_items' => 2, 'projects' => 2, 'users' => User::count()])
        ->and($engine->updatedSettings('testing_work_items')['filterableAttributes'])->toContain('project_id')
        ->and($engine->updatedSettings('testing_projects'))->toBe(config('scout.meilisearch.index-settings')[Project::class])
        ->and($engine->updatedSettings('testing_users'))->toBe(config('scout.meilisearch.index-settings')[User::class]);
});

it('skips settings for an engine without them', function () {
    config(['scout.driver' => 'null']);
    app(EngineManager::class)->forgetDrivers();

    app(SearchIndexer::class)->syncSettings();
    app(SearchIndexer::class)->removeProject('01jzzzzzzzzzzzzzzzzzzzzzzz');

    expect(app(EngineManager::class)->engine())->toBeInstanceOf(NullEngine::class);
});
