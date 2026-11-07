<?php

use App\Models\Label;
use App\Models\Page;
use App\Models\Project;
use App\Models\User;
use App\Models\WorkItem;
use App\Search\MeilisearchEngine;
use App\Search\SearchIndexer;
use Illuminate\Support\Facades\Artisan;
use Illuminate\Support\Str;
use Laravel\Scout\EngineManager;
use Meilisearch\Client;
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
