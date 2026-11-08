<?php

use App\Access\ProjectRole;
use App\Actions\Projects\DeleteProject;
use App\Jobs\ReindexWorkItems;
use App\Models\Label;
use App\Models\Page;
use App\Models\Project;
use App\Models\User;
use App\Models\WorkItem;
use App\Search\SearchIndexer;
use Illuminate\Database\Events\QueryExecuted;
use Illuminate\Support\Arr;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Exceptions;
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

it('upserts a page from the database and removes it once it is gone or its project is being deleted', function () use ($world) {
    $engine = searchEngine();
    [$web, $ops] = $world();
    [$page, $other] = Page::factory()->for($web)->count(2)->create();
    $inOps = Page::factory()->for($ops)->create();
    $indexer = app(SearchIndexer::class);

    $indexer->upsertPage($page->id);
    $indexer->upsertPage($inOps->id);
    DB::table('pages')->where('id', $page->id)->update(['title' => 'Onboarding neu', 'content_text' => 'Der erste Tag']);
    $indexer->upsertPage($page->id);

    expect(array_keys($engine->documents('testing_pages')))->toBe([$page->id, $inOps->id])
        ->and($engine->documents('testing_pages')[$page->id])->toMatchArray(['title' => 'Onboarding neu', 'text' => 'Der erste Tag']);

    DB::table('pages')->where('id', $page->id)->delete();
    DB::table('projects')->where('id', $ops->id)->update(['deleting_at' => now()]);
    $indexer->upsertPage($page->id);
    $indexer->upsertPage($inOps->id);
    $indexer->upsertPage($other->id);

    expect(array_keys($engine->documents('testing_pages')))->toBe([$other->id]);
});

it('removes pages by their ids', function () use ($world) {
    $engine = searchEngine();
    [$web] = $world();
    [$first, $second, $third] = Page::factory()->for($web)->count(3)->create();
    $indexer = app(SearchIndexer::class);
    $indexer->rebuild();
    $writes = $engine->writes();

    $indexer->removePages([$first->id, $third->id]);
    $indexer->removePages([]);

    expect(array_keys($engine->documents('testing_pages')))->toBe([$second->id])
        ->and($engine->writes())->toBe($writes + 1);
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

it('removes a project and every document of its items and pages, also when the rows are gone', function () use ($world) {
    $engine = searchEngine();
    [$web, $ops, , $inOps, $mara] = $world();
    Page::factory()->for($web)->count(2)->create();
    $kept = Page::factory()->for($ops)->create();
    $indexer = app(SearchIndexer::class);
    $indexer->rebuild();

    DeleteProject::run(actor($mara), $web);
    expect(Project::query()->find($web->id))->toBeNull(); // the purge ran (K10)

    $indexer->removeProject($web->id);

    expect(array_keys($engine->documents('testing_projects')))->toBe([$ops->id])
        ->and(array_keys($engine->documents('testing_work_items')))->toBe([$inOps->id])
        ->and(array_keys($engine->documents('testing_pages')))->toBe([$kept->id]);
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
    [$page, $gone] = Page::factory()->for($web)->count(2)->create();
    Page::factory()->for(Project::factory()->create(['deleting_at' => now()]))->create();
    $indexer = app(SearchIndexer::class);
    $indexer->rebuild();
    DB::table('work_items')->where('id', $inWeb[0]->id)->delete();
    DB::table('pages')->where('id', $gone->id)->delete();

    $counts = $indexer->rebuild();

    expect(array_keys($engine->documents('testing_work_items')))->toEqualCanonicalizing([$inWeb[1]->id, $inOps->id])
        ->and(array_keys($engine->documents('testing_projects')))->toEqualCanonicalizing([$web->id, $ops->id])
        ->and(count($engine->documents('testing_users')))->toBe(User::count())
        ->and(array_keys($engine->documents('testing_pages')))->toBe([$page->id])
        ->and($counts)->toBe(['work_items' => 2, 'pages' => 1, 'projects' => 2, 'users' => User::count()])
        ->and($engine->updatedSettings('testing_pages'))->toBe(config('scout.meilisearch.index-settings')[Page::class])
        ->and($engine->updatedSettings('testing_work_items')['filterableAttributes'])->toContain('project_id')
        ->and($engine->updatedSettings('testing_projects'))->toBe(config('scout.meilisearch.index-settings')[Project::class])
        ->and($engine->updatedSettings('testing_users'))->toBe(config('scout.meilisearch.index-settings')[User::class]);
});

it('reads the labels of the documents from work_item_labels alone', function () use ($world) {
    $engine = searchEngine();
    [$web, , [$item, $bare]] = $world();
    [$first, $second] = [Label::factory()->create(), Label::factory()->create()];
    // linked in the other order: the document names them in catalog order, as the links of a page (Task 10b)
    $item->labels()->attach([$second->id, $first->id]);
    $indexer = app(SearchIndexer::class);

    $read = [];
    DB::listen(function (QueryExecuted $query) use (&$read): void {
        if (str_contains($query->sql, 'work_item_labels')) {
            $read[] = $query->sql;
        }
    });
    $indexer->rebuild();
    $indexer->reindexItems([$web->id]);
    $indexer->upsertItem($item->id);

    // a rebuild, a reindex and an upsert each read the links once, never with a join of `labels` (its plan could begin
    // with the labels and walk every link of the organisation, Task 10b)
    expect($read)->toHaveCount(3);
    foreach ($read as $sql) {
        expect($sql)->toStartWith('select `work_item_id`, `label_id` from `work_item_labels`');
    }
    expect($engine->documents('testing_work_items')[$item->id]['label_ids'])->toBe([$first->id, $second->id])
        ->and($engine->documents('testing_work_items')[$bare->id]['label_ids'])->toBe([]);
});

it('skips settings for an engine without them', function () {
    config(['scout.driver' => 'null']);
    app(EngineManager::class)->forgetDrivers();

    app(SearchIndexer::class)->syncSettings();
    app(SearchIndexer::class)->removeProject('01jzzzzzzzzzzzzzzzzzzzzzzz');

    expect(app(EngineManager::class)->engine())->toBeInstanceOf(NullEngine::class);
});

it('needs an import while an index has no documents but its table has rows', function () {
    searchEngine();

    expect(app(SearchIndexer::class)->needsImport())->toBeTrue();
});

it('needs none once every index with rows has documents with the fields of today', function () use ($world) {
    $engine = searchEngine();
    [$web] = $world();
    Page::factory()->for($web)->create();
    app(SearchIndexer::class)->rebuild();

    foreach (['testing_work_items', 'testing_pages', 'testing_projects', 'testing_users'] as $index) {
        expect($engine->documents($index))->not->toBeEmpty("{$index} has no documents");
    }

    expect(app(SearchIndexer::class)->needsImport())->toBeFalse();
});

it('needs none for an empty table', function () {
    searchEngine();
    app(SearchIndexer::class)->rebuild();
    Project::query()->delete();
    Page::query()->delete();
    WorkItem::query()->delete();

    expect(app(SearchIndexer::class)->needsImport())->toBeFalse();
});

it('needs an import while a document of an index lacks a field its model writes today', function () {
    $engine = searchEngine();
    app(SearchIndexer::class)->rebuild();
    $first = array_key_first($engine->documents('testing_users'));
    $engine->rewrite('testing_users', fn (array $document, string $key) => $key === $first ? Arr::except($document, 'handle') : $document);

    expect(app(SearchIndexer::class)->needsImport())->toBeTrue();
});

it('needs an import while the documents of an index hold a field their model writes no more', function () use ($world) {
    $engine = searchEngine();
    $world();
    app(SearchIndexer::class)->rebuild();
    $engine->rewrite('testing_work_items', fn (array $document) => [...$document, 'estimate' => 3]);

    expect(app(SearchIndexer::class)->needsImport())->toBeTrue();
});

it('needs none while the only projects and pages are being deleted', function () {
    searchEngine();
    $project = Project::factory()->create(['deleting_at' => now()]);
    Page::factory()->for($project)->create();
    WorkItem::factory()->for($project)->create();
    app(SearchIndexer::class)->rebuild();

    expect(app(SearchIndexer::class)->needsImport())->toBeFalse();
});

it('needs none without an engine that counts', function () {
    config(['scout.driver' => 'null']);
    app(EngineManager::class)->forgetDrivers();

    expect(app(SearchIndexer::class)->needsImport())->toBeFalse();
});

it('builds the next index beside the live one and swaps it in', function () use ($world, $titles) {
    $engine = searchEngine();
    [, , [$item]] = $world();
    $indexer = app(SearchIndexer::class);
    $indexer->rebuild();
    $before = $titles($engine);
    DB::table('work_items')->where('id', $item->id)->update(['title' => 'Impressum ergänzen']);

    expect($indexer->buildNext(WorkItem::class))->toBe(3)
        ->and($titles($engine))->toBe($before)
        ->and($engine->documents('testing_work_items_next')[$item->id]['title'])->toBe('Impressum ergänzen')
        ->and($engine->updatedSettings('testing_work_items_next'))->toBe(config('scout.meilisearch.index-settings')[WorkItem::class]);

    $indexer->swapIn(WorkItem::class);

    expect($titles($engine)[$item->id])->toBe('Impressum ergänzen')
        ->and(count($titles($engine)))->toBe(3)
        ->and($engine->indexNames())->toBe(['testing_pages', 'testing_projects', 'testing_users', 'testing_work_items']);
});

it('starts the next index empty, without what an earlier rebuild left in it', function () use ($world) {
    $engine = searchEngine();
    [, , [$item, $other], $inOps] = $world();
    $engine->updateIn('testing_work_items_next', WorkItem::query()->whereKey($item->id)->get());
    DB::table('work_items')->where('id', $item->id)->delete();

    expect(array_keys($engine->documents('testing_work_items_next')))->toBe([$item->id])
        ->and(app(SearchIndexer::class)->buildNext(WorkItem::class))->toBe(2)
        ->and(array_keys($engine->documents('testing_work_items_next')))->toEqualCanonicalizing([$other->id, $inOps->id]);
});

it('leaves the old index and removes the next one when filling fails', function () use ($world, $titles) {
    $engine = searchEngine();
    $world();
    $indexer = app(SearchIndexer::class);
    $indexer->rebuild();
    $before = $titles($engine);
    DB::listen(function (QueryExecuted $query): void {
        if (str_contains($query->sql, 'from `work_items`')) {
            throw new RuntimeException('The database went away.');
        }
    });

    expect(fn () => $indexer->buildNext(WorkItem::class))->toThrow(RuntimeException::class, 'The database went away.')
        ->and($titles($engine))->toBe($before)
        ->and($engine->indexNames())->toBe(['testing_pages', 'testing_projects', 'testing_users', 'testing_work_items']);
});

it('keeps the error of the fill when the next index cannot be removed either', function () use ($world) {
    Exceptions::fake();
    $engine = searchEngine();
    $world();
    $down = new RuntimeException('Meilisearch is down.');
    DB::listen(function (QueryExecuted $query) use ($engine, $down): void {
        if (str_contains($query->sql, 'from `work_items`')) {
            $engine->failWith($down);

            throw new RuntimeException('The database went away.');
        }
    });

    expect(fn () => app(SearchIndexer::class)->buildNext(WorkItem::class))->toThrow(RuntimeException::class, 'The database went away.');

    Exceptions::assertReported(fn (RuntimeException $reported) => $reported === $down);
});

it('rebuilds in place on an engine that cannot swap', function () use ($world) {
    config(['scout.driver' => 'null']);
    app(EngineManager::class)->forgetDrivers();
    $world();

    expect(app(SearchIndexer::class)->rebuild())->toBe(['work_items' => 3, 'pages' => 0, 'projects' => 2, 'users' => User::count()]);
});

it('needs an engine that swaps to build the next index', function () {
    config(['scout.driver' => 'null']);
    app(EngineManager::class)->forgetDrivers();

    expect(fn () => app(SearchIndexer::class)->buildNext(WorkItem::class))
        ->toThrow(LogicException::class, 'The search engine cannot swap indexes.')
        ->and(fn () => app(SearchIndexer::class)->swapIn(WorkItem::class))
        ->toThrow(LogicException::class, 'The search engine cannot swap indexes.');
});
