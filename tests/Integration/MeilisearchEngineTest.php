<?php

use App\Actions\WorkItems\UpdateWorkItem;
use App\Models\Label;
use App\Models\Page;
use App\Models\Project;
use App\Models\User;
use App\Models\WorkItem;
use App\Search\MeilisearchEngine;
use App\Search\SearchConsumer;
use App\Search\SearchIndexer;
use Illuminate\Database\Events\QueryExecuted;
use Illuminate\Support\Facades\Artisan;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use Laravel\Scout\EngineManager;
use Meilisearch\Client;
use Meilisearch\Contracts\TasksQuery;
use Meilisearch\Exceptions\ApiException;
use Tests\Support\Meili;

beforeEach(fn () => Meili::use());

/** An item each in WEB and OPS, both in the index (with its settings), and Meilisearch done with them. */
$indexed = function (): array {
    $web = Project::factory()->identifier('WEB')->create();
    $ops = Project::factory()->identifier('OPS')->create();
    $inWeb = WorkItem::factory()->for($web)->create(['title' => 'Kontaktformular "prüfen"']);
    $inOps = WorkItem::factory()->for($ops)->create(['title' => 'Kontaktformular sichern']);

    Artisan::call('scout:sync-index-settings');
    WorkItem::makeAllSearchableQuery()->get()->searchable();
    Meili::settle();

    return [$web, $ops, $inWeb, $inOps];
};

it('stores documents and filters them by project', function () use ($indexed) {
    [$web, $ops, $inWeb, $inOps] = $indexed();

    expect(app(EngineManager::class)->engine())->toBeInstanceOf(MeilisearchEngine::class)
        ->and(WorkItem::search('')->whereIn('project_id', [$web->id])->keys()->all())->toBe([$inWeb->id])
        ->and(WorkItem::search('kontaktformular')->whereIn('project_id', [$web->id, $ops->id])->keys()->sort()->values()->all())
        ->toBe(collect([$inWeb->id, $inOps->id])->sort()->values()->all())
        ->and(Meili::ids('testing_work_items', 'OPS-1'))->toBe([$inOps->id]);
});

it('removes every document of a project by filter', function () use ($indexed) {
    [$web, , , $inOps] = $indexed();
    $engine = app(EngineManager::class)->engine();
    assert($engine instanceof MeilisearchEngine);

    $engine->removeWhere(new WorkItem, 'project_id', $web->id);
    $engine->removeWhere(new WorkItem, 'project_id', 'a "quoted" \\ value');
    Meili::settle();

    expect(Meili::ids('testing_work_items', ''))->toBe([$inOps->id]);
});

it('refuses to remove documents of a model without an index', function () {
    $engine = app(EngineManager::class)->engine();
    assert($engine instanceof MeilisearchEngine);

    expect(fn () => $engine->removeWhere(new Label, 'id', 'x'))
        ->toThrow(InvalidArgumentException::class, Label::class.' is not searchable.');
});

it('talks to Meilisearch through the installed HTTP client', function () {
    expect(app(Client::class)->health())->toBe(['status' => 'available']);
});

it('describes the documents of an index by their fields, a field that is null as well', function () {
    $engine = app(EngineManager::class)->engine();
    assert($engine instanceof MeilisearchEngine);

    expect($engine->documentStats('testing_users'))->toBe(['documents' => 0, 'fields' => []]);

    $project = Project::factory()->create();
    WorkItem::factory()->for($project)->create(['assignee_id' => null]);
    Page::factory()->for($project)->create();
    app(SearchIndexer::class)->rebuild();
    Meili::settle();

    $users = $engine->documentStats('testing_users');
    ksort($users['fields']);
    expect($users)->toBe(['documents' => User::count(), 'fields' => array_fill_keys(['disabled', 'handle', 'id', 'name', 'type'], User::count())])
        ->and($engine->documentStats('testing_work_items')['fields']['assignee_id'] ?? null)->toBe(1)
        ->and(app(SearchIndexer::class)->needsImport())->toBeFalse();
});

it('needs an import once a document in Meilisearch lacks a field of its model', function () {
    app(SearchIndexer::class)->rebuild();
    Meili::settle();
    app(Client::class)->index('testing_users')->addDocuments([['id' => strtolower((string) Str::ulid()), 'name' => 'Ohne Handle']]);
    Meili::settle();

    expect(app(SearchIndexer::class)->needsImport())->toBeTrue();
});

it('keeps the old index searchable while it rebuilds, and swaps the new one in', function () use ($indexed) {
    [, , $inWeb] = $indexed();
    DB::table('work_items')->where('id', $inWeb->id)->update(['title' => 'Impressum ergänzen']);
    $indexer = app(SearchIndexer::class);

    expect($indexer->buildNext(WorkItem::class))->toBe(2);
    Meili::settle();

    expect(Meili::ids('testing_work_items', 'impressum'))->toBe([])
        ->and(Meili::ids('testing_work_items', 'prüfen'))->toBe([$inWeb->id])
        ->and(Meili::ids('testing_work_items_next', 'impressum'))->toBe([$inWeb->id]);

    $indexer->swapIn(WorkItem::class);
    Meili::settle();

    expect(Meili::ids('testing_work_items', 'impressum'))->toBe([$inWeb->id])
        ->and(Meili::ids('testing_work_items', 'prüfen'))->toBe([])
        ->and(app(Client::class)->getIndex('testing_work_items')->getSettings()['filterableAttributes'])->toContain('project_id');
});

it('removes the next index after the swap', function () use ($indexed) {
    $indexed();
    $indexer = app(SearchIndexer::class);

    $indexer->buildNext(WorkItem::class);
    $indexer->swapIn(WorkItem::class);
    Meili::settle();

    expect(fn () => app(Client::class)->getIndex('testing_work_items_next'))
        ->toThrow(ApiException::class, 'Index `testing_work_items_next` not found.');
});

it('writes nothing beside the live index for no models', function () {
    $engine = app(EngineManager::class)->engine();
    assert($engine instanceof MeilisearchEngine);

    $engine->updateIn('testing_work_items_next', (new WorkItem)->newCollection());
    Meili::settle();

    expect(fn () => app(Client::class)->getIndex('testing_work_items_next'))->toThrow(ApiException::class);
});

it('swaps into an index that does not exist yet', function () {
    $item = WorkItem::factory()->create(['title' => 'Kontaktformular prüfen']);

    $counts = app(SearchIndexer::class)->rebuild();
    Meili::settle();

    expect($counts['work_items'])->toBe(1)
        ->and(Meili::ids('testing_work_items', 'kontaktformular'))->toBe([$item->id]);
});

it('leaves the old index when filling fails', function () use ($indexed) {
    [, , $inWeb] = $indexed();
    DB::table('work_items')->where('id', $inWeb->id)->update(['title' => 'Impressum ergänzen']);
    DB::listen(function (QueryExecuted $query): void {
        if (str_contains($query->sql, 'from `work_items`')) {
            throw new RuntimeException('The database went away.');
        }
    });

    expect(fn () => app(SearchIndexer::class)->buildNext(WorkItem::class))->toThrow(RuntimeException::class, 'The database went away.');
    Meili::settle();

    expect(Meili::ids('testing_work_items', 'prüfen'))->toBe([$inWeb->id])
        ->and(fn () => app(Client::class)->getIndex('testing_work_items_next'))->toThrow(ApiException::class);
});

it('leaves a foreign index alone when it rebuilds', function () {
    $client = app(Client::class);
    $foreign = ['testing_other', 'other_'.strtolower((string) Str::ulid())];

    try {
        foreach ($foreign as $index) {
            $client->waitForTask($client->index($index)->addDocuments([['id' => 'a', 'title' => 'Fremd']])['taskUid']);
        }

        app(SearchIndexer::class)->rebuild();
        Meili::settle();

        foreach ($foreign as $index) {
            expect(Meili::ids($index, 'fremd'))->toBe(['a'], "{$index} lost its documents");
        }
    } finally {
        foreach ($foreign as $index) {
            $client->waitForTask($client->deleteIndex($index)['taskUid']);
        }
    }
});

it('refuses to swap or delete an index without the prefix', function () {
    $engine = app(EngineManager::class)->engine();
    assert($engine instanceof MeilisearchEngine);

    expect(fn () => $engine->swap('work_items', 'testing_work_items_next'))
        ->toThrow(InvalidArgumentException::class, 'The index work_items does not start with testing_.')
        ->and(fn () => $engine->swap('testing_work_items', 'work_items_next'))
        ->toThrow(InvalidArgumentException::class, 'The index work_items_next does not start with testing_.')
        ->and(fn () => $engine->dropIndex('work_items'))
        ->toThrow(InvalidArgumentException::class, 'The index work_items does not start with testing_.')
        ->and(fn () => $engine->updateIn('work_items', WorkItem::query()->get()))
        ->toThrow(InvalidArgumentException::class, 'The index work_items does not start with testing_.');
});

it('refuses a prefix other than testing_', function () {
    config(['scout.prefix' => '']);

    expect(fn () => Meili::use())->toThrow(RuntimeException::class, 'Meili::use() needs the prefix testing_, not "".');
});

it('drops what an earlier rebuild left beside the live index, and asks only for leftovers', function () {
    $client = app(Client::class);
    $client->index('testing_work_items_next')->addDocuments([['id' => 'left', 'title' => 'Liegengeblieben']]);
    Meili::settle();
    $before = $client->getTasks((new TasksQuery)->setLimit(1))->getResults()[0]['uid'];
    $item = WorkItem::factory()->create(['title' => 'Kontaktformular']);

    expect(app(SearchIndexer::class)->buildNext(WorkItem::class))->toBe(1);
    Meili::settle();

    expect(Meili::ids('testing_work_items_next', ''))->toBe([$item->id]);

    app(SearchIndexer::class)->swapIn(WorkItem::class);
    app(SearchIndexer::class)->buildNext(Page::class);
    Meili::settle();
    $failed = $client->getTasks((new TasksQuery)->setStatuses(['failed'])->setTypes(['indexDeletion'])
        ->setIndexUids(['testing_work_items_next', 'testing_pages_next']))->getResults();

    expect(array_filter($failed, fn (array $task) => $task['uid'] > $before))->toBe([]);
});

it('says why it could not ask for a leftover index', function () {
    $engine = app(EngineManager::class)->engine();
    assert($engine instanceof MeilisearchEngine);

    expect(fn () => $engine->dropIndex('testing_not a name', ifExists: true))->toThrow(ApiException::class);
});

it('keeps a change the consumer wrote into the old index while it rebuilt', function () use ($indexed) {
    [, , $inWeb] = $indexed();
    consumers(SearchConsumer::class);
    $mara = User::factory()->admin()->create();
    $changed = false;
    DB::listen(function (QueryExecuted $query) use (&$changed, $mara, $inWeb): void {
        if (! $changed && str_contains($query->sql, 'from `work_items`')) {
            $changed = true;
            UpdateWorkItem::run(actor($mara), $inWeb, ['title' => 'Impressum ergänzen']);
        }
    });

    app(SearchIndexer::class)->rebuild();
    Meili::settle();

    expect($changed)->toBeTrue()
        ->and(Meili::ids('testing_work_items', 'impressum'))->toBe([$inWeb->id])
        ->and(Meili::ids('testing_work_items', 'prüfen'))->toBe([]);
});
