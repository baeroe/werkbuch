<?php

use App\Domain\Ranking\Rank;
use App\Jobs\ReindexWorkItems;
use App\Models\Project;
use App\Models\User;
use App\Models\Workflow;
use App\Models\WorkItemType;
use App\Search\SearchIndexer;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Queue;
use Illuminate\Support\Str;

/*
 * ReindexWorkItems in blocks (Phase 15, Task 11b): a job writes at most BLOCK items and hands the rest to a follow-up
 * job, so no job of a big organisation runs into its timeout. The items are written straight into the table (a factory
 * per item would take minutes for more than a block).
 */

/**
 * `$count` items of a new project in one bulk insert, numbered from 1, the title `Item <number>`.
 *
 * @return array{0: Project, 1: list<string>} the project and the ids of its items in id order
 */
$items = function (int $count): array {
    $creator = User::factory()->create();
    $project = Project::factory()->create(['lead_id' => $creator->id]);
    $type = WorkItemType::query()->where('name', 'Task')->sole()->id;
    $state = Workflow::default()->initial_state_id;
    $now = now()->utc();

    $rows = [];
    foreach (Rank::nBetween(null, null, $count) as $index => $rank) {
        $rows[] = ['id' => strtolower((string) Str::ulid()), 'project_id' => $project->id, 'number' => $index + 1, 'type_id' => $type,
            'title' => 'Item '.($index + 1), 'state_id' => $state, 'priority' => 'none', 'rank' => $rank, 'created_by' => $creator->id,
            'description_version' => 1, 'created_at' => $now, 'updated_at' => $now];
    }
    foreach (array_chunk($rows, 500) as $chunk) {
        DB::table('work_items')->insert($chunk);
    }

    $ids = array_column($rows, 'id');
    sort($ids);

    return [$project, $ids];
};

it('continues in a follow-up job after a block', function () use ($items) {
    $engine = searchEngine();
    [$project, $ids] = $items(ReindexWorkItems::BLOCK + 1);
    Queue::fake([ReindexWorkItems::class]);

    (new ReindexWorkItems([$project->id]))->handle(app(SearchIndexer::class));

    // the first block in id order, the follow-up job with the last id of it and nothing else
    $written = array_keys($engine->documents('testing_work_items'));
    sort($written);
    expect($written)->toBe(array_slice($ids, 0, ReindexWorkItems::BLOCK));
    $follow = Queue::pushed(ReindexWorkItems::class)->sole();
    expect($follow->projectIds)->toBe([$project->id])
        ->and($follow->itemIds)->toBeNull()
        ->and($follow->after)->toBe($ids[ReindexWorkItems::BLOCK - 1])
        ->and($follow->queue)->toBe('search')
        ->and($follow->timeout)->toBe(600);

    // the follow-up writes the rest and has nothing to hand on
    $follow->handle(app(SearchIndexer::class));

    $written = array_keys($engine->documents('testing_work_items'));
    sort($written);
    expect($written)->toBe($ids)
        ->and(Queue::pushed(ReindexWorkItems::class))->toHaveCount(1);

    // a block that ends with the last item hands nothing on either: BLOCK items after the first one
    (new ReindexWorkItems([$project->id], after: $ids[0]))->handle(app(SearchIndexer::class));

    expect(Queue::pushed(ReindexWorkItems::class))->toHaveCount(1);
});

it('reindexes only the named items', function () use ($items) {
    $engine = searchEngine();
    [, $ids] = $items(ReindexWorkItems::BLOCK + 3);
    // every item but the first and the last: more than a block, in blocks of the indexer within one
    $named = array_slice($ids, 1, ReindexWorkItems::BLOCK + 1);
    Queue::fake([ReindexWorkItems::class]);

    (new ReindexWorkItems(null, $named))->handle(app(SearchIndexer::class));

    $written = array_keys($engine->documents('testing_work_items'));
    sort($written);
    expect($written)->toBe(array_slice($named, 0, ReindexWorkItems::BLOCK));
    // the follow-up job carries only the ids still to write, never the whole list again
    $follow = Queue::pushed(ReindexWorkItems::class)->sole();
    expect($follow->projectIds)->toBeNull()
        ->and($follow->itemIds)->toBe([end($named)])
        ->and($follow->after)->toBeNull();

    $follow->handle(app(SearchIndexer::class));

    $written = array_keys($engine->documents('testing_work_items'));
    sort($written);
    expect($written)->toBe($named)
        ->and(Queue::pushed(ReindexWorkItems::class))->toHaveCount(1);
});
