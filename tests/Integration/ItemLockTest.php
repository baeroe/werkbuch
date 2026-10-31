<?php

use App\Exceptions\Problem;
use App\Models\Project;
use App\Models\WorkItem;
use App\Support\CatalogLock;
use App\Support\ItemLock;
use Illuminate\Database\QueryException;
use Illuminate\Support\Facades\DB;
use Tests\Support\RaceConnections;

/*
 * The locks of a change of work items (P1): the organization shared, the project shared, the item for update; a pair
 * of items by id. Two connections as in CatalogLockRaceTest: `mariadb` holds its transaction open like a request in
 * progress, `mariadb_second` is the other request and gives up waiting for a lock after one second.
 */

beforeEach(fn () => RaceConnections::setUp());

afterEach(fn () => RaceConnections::tearDown());

it('waits for a change of the catalog', function () {
    $item = WorkItem::factory()->create();

    // connection 1: a change of the catalogs holds the organization for update
    RaceConnections::hold(fn () => CatalogLock::take());

    // connection 2: a change of the item waits for it
    $outcome = RaceConnections::second(fn () => DB::transaction(fn () => ItemLock::take($item)));

    RaceConnections::expectLockWait($outcome, 'organization', null, 'lock in share mode');

    RaceConnections::release();

    $locked = RaceConnections::second(fn () => DB::transaction(fn () => ItemLock::take($item)));

    expect($locked instanceof WorkItem ? $locked->id : null)->toBe($item->id);
});

it('lets a subscription pass a change of the catalog', function () {
    $item = WorkItem::factory()->create();

    RaceConnections::hold(fn () => CatalogLock::take());

    $locked = RaceConnections::second(fn () => DB::transaction(fn () => ItemLock::take($item, false)));

    expect($locked)->toBeInstanceOf(WorkItem::class);
});

it('lets two item changes share the catalog and the project', function () {
    $item = WorkItem::factory()->create();
    $other = WorkItem::factory()->for($item->project)->create();

    // connection 1: a change of the item holds the organization and the project shared, the item for update
    RaceConnections::hold(fn () => ItemLock::take($item));

    // connection 2: a change of another item of the project does not wait
    $locked = RaceConnections::second(fn () => DB::transaction(fn () => ItemLock::take($other)));

    expect($locked)->toBeInstanceOf(WorkItem::class)
        ->and($locked instanceof WorkItem ? $locked->project->id : null)->toBe($item->project_id);

    // a change of the same item waits for the first
    RaceConnections::expectLockWait(RaceConnections::second(fn () => DB::transaction(fn () => ItemLock::take($item))), 'work_items');
});

it('makes a change of the members wait for an item change', function () {
    $item = WorkItem::factory()->create();

    RaceConnections::hold(fn () => ItemLock::take($item));

    // the project is held shared: taking it for update waits
    $outcome = RaceConnections::second(fn () => DB::transaction(fn () => Project::query()->lockForUpdate()->findOrFail($item->project_id)));

    RaceConnections::expectLockWait($outcome, 'projects');
});

it('answers 404 for an item deleted meanwhile', function () {
    $item = WorkItem::factory()->create();

    // connection 1: the item is deleted, and committed just before connection 2 asks for its row
    RaceConnections::hold(fn () => WorkItem::query()->whereKey($item->id)->delete());
    RaceConnections::releaseBeforeLock('work_items');

    $outcome = RaceConnections::second(fn () => DB::transaction(fn () => ItemLock::take($item)));

    expect($outcome)->toBeInstanceOf(Problem::class)
        ->and($outcome instanceof Problem ? $outcome->status : null)->toBe(404);
});

it('answers 404 for an item of a project that is being deleted', function () {
    $item = WorkItem::factory()->create();
    $other = WorkItem::factory()->create();
    $item->project->update(['deleting_at' => now()]);

    foreach ([fn () => ItemLock::take($item), fn () => ItemLock::pair($other, $item), fn () => ItemLock::pair($item, $other)] as $lock) {
        expect(fn () => DB::transaction($lock))->toThrow(Problem::class);
    }

    $item->project->delete();

    expect(fn () => DB::transaction(fn () => ItemLock::take($item)))->toThrow(Problem::class)
        ->and(fn () => DB::transaction(fn () => ItemLock::pair($other, $item)))->toThrow(Problem::class);
});

it('answers 404 for a pair with an item deleted meanwhile', function () {
    $item = WorkItem::factory()->create();
    $other = WorkItem::factory()->for($item->project)->create();
    WorkItem::query()->whereKey($other->id)->delete();

    expect(fn () => DB::transaction(fn () => ItemLock::pair($item, $other)))->toThrow(Problem::class);
});

it('locks a pair in id order', function () {
    $project = Project::factory()->create();
    [$a, $b] = WorkItem::factory()->for($project)->count(2)->create()->sortBy('id')->values()->all();
    $foreign = WorkItem::factory()->create();

    // connection 1: a relation from A to B holds both items
    RaceConnections::hold(fn () => ItemLock::pair($a, $b));

    // connection 2: a relation from B to A asks for A first, never for B before A: it waits, it does not deadlock
    $outcome = RaceConnections::second(fn () => DB::transaction(fn () => ItemLock::pair($b, $a)));

    RaceConnections::expectLockWait($outcome, 'work_items');
    expect($outcome instanceof QueryException ? $outcome->getBindings() : null)->toBe([$a->id]);

    RaceConnections::release();

    $pair = RaceConnections::second(fn () => DB::transaction(fn () => ItemLock::pair($b, $a)));
    $across = RaceConnections::second(fn () => DB::transaction(fn () => ItemLock::pair($foreign, $a)));

    expect(is_array($pair) ? [$pair[0]->id, $pair[1]->id] : null)->toBe([$b->id, $a->id])
        ->and(is_array($pair) ? $pair[0]->project->id : null)->toBe($project->id)
        ->and(is_array($across) ? [$across[0]->project->id, $across[1]->project->id] : null)->toBe([$foreign->project_id, $project->id]);
});

it('locks the projects of a pair in id order', function () {
    [$first, $second] = Project::factory()->count(2)->create()->sortBy('id')->values()->all();
    $a = WorkItem::factory()->for($first)->create();
    $b = WorkItem::factory()->for($second)->create();
    $asked = [];
    DB::listen(function ($query) use (&$asked) {
        if (str_starts_with($query->sql, 'select * from `projects`')) {
            $asked[] = [$query->bindings[0], str_ends_with($query->sql, 'lock in share mode')];
        }
    });

    DB::transaction(fn () => ItemLock::pair($b, $a));

    expect($asked)->toBe([[$first->id, true], [$second->id, true]]);
});
