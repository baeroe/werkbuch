<?php

use App\Access\ProjectRole;
use App\Actions\WorkItems\RedistributeRanks;
use App\Actions\WorkItems\UpdateWorkItem;
use App\Domain\Ranking\Rank;
use App\Models\Project;
use App\Models\User;
use App\Models\WorkItem;
use Illuminate\Support\Facades\DB;
use Tests\Support\RaceConnections;

/*
 * Redistributing the ranks of a project (A448) holds the row of the project `for update` while it reads the order and
 * writes the new ranks. A change of an item takes the project shared (ItemLock::take): a `PATCH rank` of the same
 * project waits until the new ranks are committed and then places the item among them, never in the middle of the
 * rewrite. Items of other projects never wait: the items are read over the index (`project_id`, `number`), not over
 * `PRIMARY`, which under REPEATABLE READ would keep every scanned row of every project locked. Two connections as in
 * ProjectMemberRaceTest.
 */

beforeEach(fn () => RaceConnections::setUp());

afterEach(fn () => RaceConnections::tearDown());

it('makes a change of a rank wait for the redistribution and then lands between the new ranks', function () {
    $mara = User::factory()->create();
    $web = Project::factory()->identifier('WEB')->member($mara, ProjectRole::Admin)->create(['lead_id' => $mara->id]);
    [$first, $second, $third] = WorkItem::factory()->for($web)->count(3)->create()->all();
    foreach ([$first, $second, $third] as $n => $item) {
        DB::table('work_items')->where('id', $item->id)->update(['rank' => 'a'.$n.str_repeat('V', 120)]);
    }

    // connection 1: the ranks get redistributed, the transaction stays open
    RaceConnections::hold(fn () => RedistributeRanks::run(actor($mara), $web));

    // connection 2: moving the third item waits for the project instead of writing among the ranks being rewritten
    $move = fn () => UpdateWorkItem::run(actor($mara), WorkItem::query()->findOrFail($third->id), [
        'rank' => Rank::between((string) WorkItem::query()->findOrFail($first->id)->rank, (string) WorkItem::query()->findOrFail($second->id)->rank),
    ]);
    RaceConnections::expectLockWait(RaceConnections::second($move), 'projects', 'select * from `projects`', 'lock in share mode');

    RaceConnections::release();

    // the move reads the neighbours after the redistribution, as the board does after loading again (Task 21e)
    expect(RaceConnections::second($move))->toBeInstanceOf(WorkItem::class);

    $ranks = Rank::nBetween(null, null, 3);
    $after = WorkItem::query()->where('project_id', $web->id)->orderBy('rank')->orderBy('id')->get(['id', 'rank']);
    expect($after->pluck('id')->all())->toBe([$first->id, $third->id, $second->id])
        ->and($after[0]->rank)->toBe($ranks[0])
        ->and($after[2]->rank)->toBe($ranks[1])
        ->and(strcmp($after[1]->rank, $ranks[0]))->toBeGreaterThan(0)
        ->and(strcmp($after[1]->rank, $ranks[1]))->toBeLessThan(0)
        ->and(strlen($after[1]->rank))->toBeLessThanOrEqual(3);
});

it('lets a change of an item of another project through while the ranks get redistributed', function () {
    $mara = User::factory()->create();
    // the item of OPS comes first: its ULID is smaller than those of WEB, a scan over PRIMARY reads it before them
    $ops = Project::factory()->identifier('OPS')->member($mara, ProjectRole::Admin)->create(['lead_id' => $mara->id]);
    $other = WorkItem::factory()->for($ops)->create(['title' => 'Before']);
    $web = Project::factory()->identifier('WEB')->member($mara, ProjectRole::Admin)->create(['lead_id' => $mara->id]);
    foreach (WorkItem::factory()->for($web)->count(3)->create() as $n => $item) {
        DB::table('work_items')->where('id', $item->id)->update(['rank' => 'a'.$n.str_repeat('V', 120)]);
    }
    // and one of APP after them: in the index (`project_id`, `number`) it follows the last item of WEB
    $app = Project::factory()->identifier('APP')->member($mara, ProjectRole::Admin)->create(['lead_id' => $mara->id]);
    $next = WorkItem::factory()->for($app)->create();
    expect(strcmp($other->id, (string) WorkItem::query()->where('project_id', $web->id)->min('id')))->toBeLessThan(0)
        ->and(strcmp($app->id, $web->id))->toBeGreaterThan(0);

    // connection 1: the ranks of WEB get redistributed, the transaction stays open
    RaceConnections::hold(fn () => RedistributeRanks::run(actor($mara), $web));

    // connection 2: a change of the item of OPS goes through without waiting
    $rename = RaceConnections::second(fn () => UpdateWorkItem::run(actor($mara), WorkItem::query()->findOrFail($other->id), ['title' => 'After']));
    expect($rename)->toBeInstanceOf(WorkItem::class)
        ->and(RaceConnections::second(fn () => DB::table('work_items')->where('id', $other->id)->update(['priority' => 'high'])))->toBe(1)
        ->and(RaceConnections::second(fn () => UpdateWorkItem::run(actor($mara), WorkItem::query()->findOrFail($next->id), ['title' => 'Next'])))->toBeInstanceOf(WorkItem::class);

    RaceConnections::release();

    $after = DB::table('work_items')->where('id', $other->id)->first(['title', 'priority']);
    expect($after?->title)->toBe('After')->and($after?->priority)->toBe('high')
        ->and(DB::table('work_items')->where('id', $next->id)->value('title'))->toBe('Next');
});
