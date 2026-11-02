<?php

use App\Models\Label;
use App\Models\Project;
use App\Models\WorkItem;
use App\Search\MeilisearchEngine;
use Illuminate\Support\Facades\Artisan;
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
