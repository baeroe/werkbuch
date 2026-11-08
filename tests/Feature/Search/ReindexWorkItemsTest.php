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
 * `$count` items of a new project in one bulk insert, numbered from 1, the title `Item <number>`; with `$others` that
 * many items of a second project inserted in between, so their ids lie among those of the first.
 *
 * @return array{0: Project, 1: list<string>, 2: list<string>} the project, the ids of its items in id order and those of
 *                                                             the other project
 */
$items = function (int $count, int $others = 0): array {
    $creator = User::factory()->create();
    $project = Project::factory()->create(['lead_id' => $creator->id]);
    $other = Project::factory()->create(['lead_id' => $creator->id]);
    $type = WorkItemType::query()->where('name', 'Task')->sole()->id;
    $state = Workflow::default()->initial_state_id;
    $now = now()->utc();

    $rows = [];
    $numbers = [$project->id => 0, $other->id => 0];
    foreach (Rank::nBetween(null, null, $count + $others) as $index => $rank) {
        // every second row of the other project, as long as it has items left
        $in = $index % 2 === 1 && $numbers[$other->id] < $others ? $other->id : $project->id;
        $number = ++$numbers[$in];
        $rows[] = ['id' => strtolower((string) Str::ulid()), 'project_id' => $in, 'number' => $number, 'type_id' => $type,
            'title' => "Item {$number}", 'state_id' => $state, 'priority' => 'none', 'rank' => $rank, 'created_by' => $creator->id,
            'description_version' => 1, 'created_at' => $now, 'updated_at' => $now];
    }
    foreach (array_chunk($rows, 500) as $chunk) {
        DB::table('work_items')->insert($chunk);
    }

    $of = function (string $projectId) use ($rows): array {
        $ids = array_column(array_filter($rows, fn (array $row) => $row['project_id'] === $projectId), 'id');
        sort($ids);

        return $ids;
    };

    return [$project, $of($project->id), $of($other->id)];
};

/** The ids of the item documents, sorted. */
$written = function ($engine): array {
    $ids = array_keys($engine->documents('testing_work_items'));
    sort($ids);

    return $ids;
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
        ->and($follow->timeout)->toBe(60);

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

it('keeps to the projects named across blocks, or takes every project', function () use ($items, $written) {
    $engine = searchEngine();
    [$project, $ids, $others] = $items(ReindexWorkItems::BLOCK + 1, 999);
    // the ids of the other project lie among those of the first: the block of a project is no range of ids
    expect($others[0])->toBeGreaterThan($ids[0])
        ->and(end($others))->toBeLessThan($ids[ReindexWorkItems::BLOCK - 1]);
    Queue::fake([ReindexWorkItems::class]);

    (new ReindexWorkItems([$project->id]))->handle(app(SearchIndexer::class));
    Queue::pushed(ReindexWorkItems::class)->sole()->handle(app(SearchIndexer::class));

    expect($written($engine))->toBe($ids)
        ->and(Queue::pushed(ReindexWorkItems::class))->toHaveCount(1);

    // every project: the first block of all ids, then the rest from the last id of it on
    $engine = searchEngine();
    $all = [...$ids, ...$others];
    sort($all);
    Queue::fake([ReindexWorkItems::class]);

    (new ReindexWorkItems(null))->handle(app(SearchIndexer::class));

    expect($written($engine))->toBe(array_slice($all, 0, ReindexWorkItems::BLOCK));
    $follow = Queue::pushed(ReindexWorkItems::class)->sole();
    expect($follow->projectIds)->toBeNull()
        ->and($follow->itemIds)->toBeNull()
        ->and($follow->after)->toBe($all[ReindexWorkItems::BLOCK - 1]);

    $follow->handle(app(SearchIndexer::class));

    expect($written($engine))->toBe($all)
        ->and(Queue::pushed(ReindexWorkItems::class))->toHaveCount(1);
});

it('writes a block of whole chunks of the indexer', function () {
    // the limit of a block works at the end of a chunk: a block of whole chunks writes exactly BLOCK items
    expect(ReindexWorkItems::BLOCK % SearchIndexer::CHUNK)->toBe(0);
});

it('runs a job queued before the blocks', function () use ($items, $written) {
    $engine = searchEngine();
    [$project, $ids] = $items(3);
    // the payload of a job queued before Task 11b (written by its class then): `itemIds` null, no `after`
    $old = sprintf('O:%d:"%s":3:{s:10:"projectIds";a:1:{i:0;s:26:"%s";}s:7:"itemIds";N;s:5:"queue";s:6:"search";}',
        strlen(ReindexWorkItems::class), ReindexWorkItems::class, $project->id);

    unserialize($old)->handle(app(SearchIndexer::class));

    expect($written($engine))->toBe($ids);
});
