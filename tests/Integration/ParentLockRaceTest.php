<?php

use App\Access\ProjectRole;
use App\Actions\WorkItems\ChangeWorkItemType;
use App\Actions\WorkItems\UpdateWorkItem;
use App\Exceptions\Problem;
use App\Models\Project;
use App\Models\User;
use App\Models\WorkItem;
use App\Models\WorkItemType;
use Tests\Support\RaceConnections;

/*
 * Two levels under concurrency (spec 4.8): a change that gives an item a parent reads the parent under a shared lock
 * (ItemInput, after the lock of the item itself), and a type change counts the children of the item under its own lock
 * (`for update`). So a new child and a type change of its parent never pass each other: whichever comes second waits
 * and then sees what the first one left. `mariadb` holds its transaction open like a request in progress,
 * `mariadb_second` is the other request and gives up waiting for a lock after one second.
 */

beforeEach(fn () => RaceConnections::setUp());

afterEach(fn () => RaceConnections::tearDown());

/** WEB with Mara as its admin, an epic and a task without a parent. */
$world = function (): array {
    $mara = User::factory()->create(['name' => 'Mara']);
    $web = Project::factory()->identifier('WEB')->member($mara, ProjectRole::Admin)->create(['lead_id' => $mara->id]);
    $epic = WorkItem::factory()->for($web)->epic()->create(['created_by' => $mara->id]);
    $task = WorkItem::factory()->for($web)->create(['created_by' => $mara->id]);

    return [$epic, $task, $mara, WorkItemType::query()->where('name', 'Task')->firstOrFail()];
};

it('makes a new child wait for a type change of its parent and then refuses it', function () use ($world) {
    [$epic, $task, $mara, $taskType] = $world();

    RaceConnections::hold(fn () => ChangeWorkItemType::run(actor($mara), $epic, ['type_id' => $taskType->id]));

    RaceConnections::expectLockWait(
        RaceConnections::second(fn () => UpdateWorkItem::run(actor($mara), $task, ['parent_id' => $epic->id])),
        'work_items',
        sqlEnd: 'lock in share mode',
    );

    RaceConnections::releaseBeforeLock('work_items', 'lock in share mode');
    $second = RaceConnections::second(fn () => UpdateWorkItem::run(actor($mara), $task, ['parent_id' => $epic->id]));

    expect($second)->toBeInstanceOf(Problem::class);
    assert($second instanceof Problem);
    expect([$second->status, $second->reason])->toBe([422, 'parent_not_epic'])
        ->and($task->fresh()?->parent_id)->toBeNull()
        ->and($epic->fresh()?->type_id)->toBe($taskType->id);
});

it('makes a type change wait for a new child and then counts it', function () use ($world) {
    [$epic, $task, $mara, $taskType] = $world();

    RaceConnections::hold(fn () => UpdateWorkItem::run(actor($mara), $task, ['parent_id' => $epic->id]));

    RaceConnections::expectLockWait(
        RaceConnections::second(fn () => ChangeWorkItemType::run(actor($mara), $epic, ['type_id' => $taskType->id])),
        'work_items',
    );

    RaceConnections::releaseBeforeLock('work_items');
    $second = RaceConnections::second(fn () => ChangeWorkItemType::run(actor($mara), $epic, ['type_id' => $taskType->id]));

    expect($second)->toBeInstanceOf(Problem::class);
    assert($second instanceof Problem);
    expect([$second->status, $second->reason, $second->errors])->toBe([422, 'parent_not_epic', ['type_id' => [__('items.hierarchy.has_children', ['key' => 'WEB-1'])]]])
        ->and($task->fresh()?->parent_id)->toBe($epic->id)
        ->and($epic->fresh()?->type_id)->not->toBe($taskType->id);
});
