<?php

use App\Access\ProjectRole;
use App\Actions\WorkItems\CreateWorkItem;
use App\Models\Project;
use App\Models\User;
use App\Models\WorkItem;
use Tests\Support\RaceConnections;

/*
 * Two items created in one project at the same time never get the same number (Review Focus 1): CreateWorkItem takes
 * the row of the project `lockForUpdate` (MemberInput::lock) after the shared lock of the organization and reads
 * `next_number` and the last rank under it. Two connections as in ProjectMemberRaceTest: `mariadb` holds its
 * transaction open like a request in progress, `mariadb_second` is the other request and gives up waiting for a lock
 * after one second.
 */

beforeEach(fn () => RaceConnections::setUp());

afterEach(fn () => RaceConnections::tearDown());

/** WEB with two members who both create items. */
$world = function (): array {
    $mara = User::factory()->create();
    $web = Project::factory()->identifier('WEB')->member($mara, ProjectRole::Admin)->create(['lead_id' => $mara->id]);

    return [$web, $mara, memberOf($web, ProjectRole::Member)];
};

it('makes the second creation wait for the project', function () use ($world) {
    [$web, $mara, $lene] = $world();

    RaceConnections::hold(fn () => CreateWorkItem::run(actor($mara), ['project_id' => $web->id, 'title' => 'Eins']));

    RaceConnections::expectLockWait(RaceConnections::second(fn () => CreateWorkItem::run(actor($lene), ['project_id' => $web->id, 'title' => 'Zwei'])), 'projects');

    RaceConnections::release();

    expect(WorkItem::query()->pluck('number')->all())->toBe([1]);
});

it('gives the second item the next number', function () use ($world) {
    [$web, $mara, $lene] = $world();

    RaceConnections::hold(fn () => CreateWorkItem::run(actor($mara), ['project_id' => $web->id, 'title' => 'Eins']));
    RaceConnections::releaseBeforeLock('projects');

    $second = RaceConnections::second(fn () => CreateWorkItem::run(actor($lene), ['project_id' => $web->id, 'title' => 'Zwei']));
    $items = WorkItem::query()->orderBy('number')->get();

    expect($second)->toBeInstanceOf(WorkItem::class)
        ->and($items->map(fn (WorkItem $item) => [$item->number, $item->title])->all())->toBe([[1, 'Eins'], [2, 'Zwei']])
        ->and(strcmp($items[1]->rank, $items[0]->rank))->toBeGreaterThan(0)
        ->and($web->fresh()?->next_number)->toBe(2);
});
