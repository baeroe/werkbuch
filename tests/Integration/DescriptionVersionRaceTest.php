<?php

use App\Access\ProjectRole;
use App\Actions\WorkItems\UpdateWorkItem;
use App\Exceptions\Problem;
use App\Models\Project;
use App\Models\User;
use App\Models\WorkItem;
use Tests\Support\RaceConnections;

/*
 * Two windows edit the same description (Review Focus 2): UpdateWorkItem compares `base_description_version` with the
 * version of the item under its lock (ItemLock::take, the item `for update`), so the second edit on the same version
 * waits for the first and then sees the version it left: a 409 `description_conflict` instead of a silent overwrite.
 * `mariadb` holds its transaction open like a request in progress, `mariadb_second` is the other request and gives up
 * waiting for a lock after one second.
 */

beforeEach(fn () => RaceConnections::setUp());

afterEach(fn () => RaceConnections::tearDown());

/** WEB with two members and an item without a description (version 1). */
$world = function (): array {
    $mara = User::factory()->create(['name' => 'Mara']);
    $web = Project::factory()->identifier('WEB')->member($mara, ProjectRole::Admin)->create(['lead_id' => $mara->id]);
    $lene = memberOf($web, ProjectRole::Member, ['name' => 'Lene']);

    return [WorkItem::factory()->for($web)->create(['created_by' => $mara->id]), $mara, $lene];
};

it('makes a second edit of the description wait for the item', function () use ($world) {
    [$item, $mara, $lene] = $world();

    RaceConnections::hold(fn () => UpdateWorkItem::run(actor($mara), $item, ['description' => 'Fassung von Mara', 'base_description_version' => 1]));

    RaceConnections::expectLockWait(RaceConnections::second(fn () => UpdateWorkItem::run(actor($lene), $item, ['description' => 'Fassung von Lene', 'base_description_version' => 1])), 'work_items');

    RaceConnections::release();

    expect($item->fresh()?->description_text)->toBe('Fassung von Mara');
});

it('refuses the second edit on the old version once the first is saved', function () use ($world) {
    [$item, $mara, $lene] = $world();

    RaceConnections::hold(fn () => UpdateWorkItem::run(actor($mara), $item, ['description' => 'Fassung von Mara', 'base_description_version' => 1]));
    RaceConnections::releaseBeforeLock('work_items');

    $second = RaceConnections::second(fn () => UpdateWorkItem::run(actor($lene), $item, ['description' => 'Fassung von Lene', 'base_description_version' => 1]));
    $stored = $item->fresh();

    expect($second)->toBeInstanceOf(Problem::class);
    assert($second instanceof Problem);
    expect([$second->status, $second->reason, $second->detail])->toBe([409, 'description_conflict', __('problem.detail.description_conflict', ['name' => 'Mara'])])
        ->and($second->extensions['current']['description_version'])->toBe(2)
        ->and($stored?->description_text)->toBe('Fassung von Mara')
        ->and($stored?->description_version)->toBe(2);
});
