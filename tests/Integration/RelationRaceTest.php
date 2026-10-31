<?php

use App\Access\ProjectRole;
use App\Actions\WorkItems\AddRelation;
use App\Models\Project;
use App\Models\RelationType;
use App\Models\User;
use App\Models\WorkItem;
use App\Models\WorkItemRelation;
use Illuminate\Validation\ValidationException;
use Tests\Support\RaceConnections;

/*
 * Two people relate the same two items at the same time (Task 11): AddRelation locks both items (ItemLock::pair, by id,
 * so A→B and B→A take the locks in the same order) and checks for the same pair only under those locks. The unique
 * index covers one direction only; for a symmetric type the other direction is the same pair, and only the check under
 * the lock sees it. `mariadb` holds its transaction open like a request in progress, `mariadb_second` is the other
 * request and gives up waiting for a lock after one second.
 */

beforeEach(fn () => RaceConnections::setUp());

afterEach(fn () => RaceConnections::tearDown());

/** WEB with two members and two items; the built-in symmetric type `relates`. */
$world = function (): array {
    $mara = User::factory()->create(['name' => 'Mara']);
    $web = Project::factory()->identifier('WEB')->member($mara, ProjectRole::Admin)->create(['lead_id' => $mara->id]);
    $lene = memberOf($web, ProjectRole::Member, ['name' => 'Lene']);
    [$a, $b] = WorkItem::factory()->for($web)->count(2)->create(['created_by' => $mara->id]);

    return [$a, $b, $mara, $lene, RelationType::query()->where('built_in', 'relates')->firstOrFail()];
};

it('makes a second relation between the same items wait', function () use ($world) {
    [$a, $b, $mara, $lene, $relates] = $world();

    RaceConnections::hold(fn () => AddRelation::run(actor($mara), $a, ['type_id' => $relates->id, 'target_id' => $b->id]));

    RaceConnections::expectLockWait(RaceConnections::second(fn () => AddRelation::run(actor($lene), $b, ['type_id' => $relates->id, 'target_id' => $a->id])), 'work_items');

    RaceConnections::release();

    expect(WorkItemRelation::query()->count())->toBe(1);
});

it('refuses the second one as a duplicate once the first is saved', function () use ($world) {
    [$a, $b, $mara, $lene, $relates] = $world();

    RaceConnections::hold(fn () => AddRelation::run(actor($mara), $a, ['type_id' => $relates->id, 'target_id' => $b->id]));
    RaceConnections::releaseBeforeLock('work_items');

    $second = RaceConnections::second(fn () => AddRelation::run(actor($lene), $b, ['type_id' => $relates->id, 'target_id' => $a->id]));

    expect($second)->toBeInstanceOf(ValidationException::class);
    assert($second instanceof ValidationException);
    expect($second->errors())->toBe(['target_id' => [__('field.target_id.duplicate')]])
        ->and(WorkItemRelation::query()->get(['source_id', 'target_id'])->toArray())->toBe([['source_id' => $a->id, 'target_id' => $b->id]]);
});
