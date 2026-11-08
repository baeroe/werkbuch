<?php

use App\Access\ProjectRole;
use App\Actions\WorkItems\DeleteWorkItem;
use App\Actions\WorkItems\LinkReferences;
use App\Models\Project;
use App\Models\User;
use App\Models\WorkItem;
use App\Models\WorkItemRelation;
use App\Support\Actor;
use Tests\Support\RaceConnections;

/*
 * The automation `link_references` after the commit (A453): each target is related in a transaction of its own under
 * the locks of AddRelation (ItemLock::pair, by id). Two jobs relating A to B and B to A at once wait for each other and
 * make one relation; a job whose target is being deleted waits for the deletion and passes the target over. `mariadb`
 * holds its transaction open like the first job, `mariadb_second` is the other one and gives up waiting after a second.
 */

beforeEach(fn () => RaceConnections::setUp());

afterEach(fn () => RaceConnections::tearDown());

/** WEB with Mara as its admin and two items. */
$world = function (): array {
    $mara = User::factory()->create(['name' => 'Mara']);
    $web = Project::factory()->identifier('WEB')->member($mara, ProjectRole::Admin)->create(['lead_id' => $mara->id]);
    [$a, $b] = WorkItem::factory()->for($web)->count(2)->create(['created_by' => $mara->id]);

    return [$a, $b, $mara];
};

$link = fn (WorkItem $source, WorkItem $target, User $writer): int => LinkReferences::run(Actor::automationFor(LinkReferences::REASON, actor($writer)), $source->id, [$target->id], $writer->id);

it('makes the second job wait while the first relates the pair', function () use ($world, $link) {
    [$a, $b, $mara] = $world();

    expect(RaceConnections::hold(fn () => $link($a, $b, $mara)))->toBe(1);

    RaceConnections::expectLockWait(RaceConnections::second(fn () => $link($b, $a, $mara)), 'work_items');

    RaceConnections::release();

    expect(WorkItemRelation::query()->count())->toBe(1);
});

it('makes one relation when A names B and B names A at once', function () use ($world, $link) {
    [$a, $b, $mara] = $world();

    RaceConnections::hold(fn () => $link($a, $b, $mara));
    RaceConnections::releaseBeforeLock('work_items');

    $second = RaceConnections::second(fn () => $link($b, $a, $mara));

    expect($second)->toBe(0)
        ->and(WorkItemRelation::query()->get(['source_id', 'target_id'])->toArray())->toBe([['source_id' => $a->id, 'target_id' => $b->id]]);
});

it('waits for the deletion of the target and passes it over', function () use ($world, $link) {
    [$a, $b, $mara] = $world();

    RaceConnections::hold(fn () => DeleteWorkItem::run(actor($mara), $b));
    RaceConnections::expectLockWait(RaceConnections::second(fn () => $link($a, $b, $mara)), 'work_items');

    RaceConnections::releaseBeforeLock('work_items');
    $second = RaceConnections::second(fn () => $link($a, $b, $mara));

    expect($second)->toBe(0)
        ->and(WorkItem::query()->whereKey($b->id)->exists())->toBeFalse()
        ->and(WorkItem::query()->whereKey($a->id)->exists())->toBeTrue()
        ->and(WorkItemRelation::query()->count())->toBe(0);
});
