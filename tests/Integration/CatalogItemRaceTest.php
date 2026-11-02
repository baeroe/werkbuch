<?php

use App\Access\ProjectRole;
use App\Actions\WorkItems\CreateWorkItem;
use App\Actions\WorkItemTypes\SaveWorkItemType;
use App\Models\Project;
use App\Models\User;
use App\Models\WorkItem;
use App\Models\WorkItemType;
use Illuminate\Validation\ValidationException;
use Tests\Support\RaceConnections;

/*
 * A change of the catalog that checks the items (the epic mark of a type, spec 4.8) while an item is being written:
 * every change of an item holds the organization shared (CatalogLock::share()), the change of the catalog takes it
 * `for update` (CatalogLock::take()) and counts the items under it. So the catalog waits for the item and then sees it.
 * `mariadb` holds its transaction open like a request in progress, `mariadb_second` is the other request and gives up
 * waiting for a lock after one second.
 */

beforeEach(fn () => RaceConnections::setUp());

afterEach(fn () => RaceConnections::tearDown());

it('refuses to drop the epic flag while a child is being created', function () {
    $admin = User::factory()->admin()->create(['name' => 'Mara']);
    $web = Project::factory()->identifier('WEB')->member($admin, ProjectRole::Admin)->create(['lead_id' => $admin->id]);
    $epic = WorkItem::factory()->for($web)->epic()->create(['created_by' => $admin->id]);
    $type = WorkItemType::query()->whereKey($epic->type_id)->firstOrFail();
    // the epic type as an admin sends it back, without the mark; read on the connection of the request
    $drop = fn () => SaveWorkItemType::run(actor($admin), WorkItemType::query()->findOrFail($type->id), [
        'name' => $type->name, 'icon' => $type->icon, 'tone' => $type->tone->value, 'description' => $type->description,
        'is_epic' => false, 'properties' => [],
    ]);

    // connection 1: a child of WEB-1 is being created, the transaction stays open
    RaceConnections::hold(fn () => CreateWorkItem::run(actor($admin), ['project_id' => 'WEB', 'title' => 'Kind', 'parent_id' => $epic->key]));

    // connection 2: the type waits for the organization instead of counting the children it saw before
    RaceConnections::expectLockWait(RaceConnections::second($drop), 'organization');

    // the child commits the moment the type asks again: under the lock it finds the child
    RaceConnections::releaseBeforeLock('organization');
    $outcome = RaceConnections::second($drop);

    expect($outcome)->toBeInstanceOf(ValidationException::class);
    assert($outcome instanceof ValidationException);
    expect($outcome->errors())->toBe(['is_epic' => [__('field.is_epic.has_children')]])
        ->and($type->fresh()?->is_epic)->toBeTrue()
        ->and(WorkItem::query()->where('parent_id', $epic->id)->count())->toBe(1);
});
