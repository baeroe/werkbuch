<?php

use App\Access\ProjectRole;
use App\Actions\WorkItems\RedistributeRanks;
use App\Domain\Ranking\Rank;
use App\Events\EventType;
use App\Exceptions\Problem;
use App\Models\Event;
use App\Models\Project;
use App\Models\User;
use App\Models\WorkItem;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;

/*
 * The server gives the items of a project new short ranks in their order (A448, changes A180): all items, archived ones
 * too, by `rank` (byte by byte) and `id`, under the lock of the project. Only the rows whose rank changes are written,
 * without `updated_at` and without an event per item (the manual order is no history, A320); one
 * `project.ranks_redistributed` for the project when anything changed.
 */

$world = function (): array {
    $mara = User::factory()->create(['name' => 'Mara', 'handle' => 'mara']);
    $web = Project::factory()->identifier('WEB')->public()->member($mara, ProjectRole::Admin)->create(['lead_id' => $mara->id]);
    $jonas = memberOf($web, ProjectRole::Member, ['name' => 'Jonas', 'handle' => 'jonas']);
    $lene = memberOf($web, ProjectRole::Viewer, ['name' => 'Lene', 'handle' => 'lene']);

    return compact('mara', 'web', 'jonas', 'lene');
};

/** The ids of the items of the project in their manual order, as the lists read it. */
$order = fn (Project $project): array => WorkItem::query()->where('project_id', $project->id)
    ->orderBy('rank')->orderBy('id')->pluck('id')->all();

it('keeps the order and shortens every rank', function () use ($world, $order) {
    $w = $world();
    $items = WorkItem::factory()->for($w['web'])->count(60)->create();
    // ranks of 120 characters, two items each sharing one: the id decides between them
    foreach ($items->values() as $n => $item) {
        $rank = 'a'.str_repeat('V', 117).sprintf('%02d', intdiv($n, 2) * 2 % 60);
        DB::table('work_items')->where('id', $item->id)->update(['rank' => $rank, 'updated_at' => '2026-10-01 08:00:00']);
    }
    $before = $order($w['web']);
    expect(collect($before)->map(fn (string $id) => strlen((string) DB::table('work_items')->where('id', $id)->value('rank')))->unique()->all())->toBe([120]);

    Carbon::setTestNow('2026-11-08 09:00:00');
    $count = RedistributeRanks::run(actor($w['jonas']), $w['web']);

    $after = WorkItem::query()->where('project_id', $w['web']->id)->orderBy('rank')->orderBy('id')->get(['id', 'rank', 'updated_at']);
    expect($count)->toBe(60)
        ->and($after->pluck('id')->all())->toBe($before)
        ->and($after->pluck('rank')->all())->toBe(Rank::nBetween(null, null, 60))
        ->and($after->pluck('rank')->unique())->toHaveCount(60)
        ->and($after->every(fn (WorkItem $item) => strlen($item->rank) <= 3))->toBeTrue()
        ->and($after->every(fn (WorkItem $item) => $item->updated_at?->toDateTimeString() === '2026-10-01 08:00:00'))->toBeTrue();

    $event = eventsOf(EventType::ProjectRanksRedistributed)->sole();
    expect($event->subject_id)->toBe($w['web']->id)
        ->and($event->project_id)->toBe($w['web']->id)
        ->and($event->actor_id)->toBe($w['jonas']->id)
        ->and($event->changes)->toBeNull()
        ->and($event->meta['count'])->toBe(60)
        ->and(Event::query()->where('type', 'like', 'work_item.%')->count())->toBe(0);
});

it('reads and writes more items than a block in blocks and keeps their order across the border', function () use ($world, $order) {
    $w = $world();
    $count = RedistributeRanks::BLOCK + 1;
    $items = WorkItem::factory()->for($w['web'])->count($count)->create();
    // long ranks in the reverse order of the numbers: the order crosses the border between the blocks of `number`
    $ranks = Rank::nBetween(null, null, $count);
    foreach ($items->values() as $n => $item) {
        DB::table('work_items')->where('id', $item->id)->update(['rank' => $ranks[$count - 1 - $n].str_repeat('V', 100)]);
    }
    $before = $order($w['web']);
    expect($before[0])->toBe($items->last()->id)->and($before[$count - 1])->toBe($items->first()->id);

    $reads = [];
    $writes = [];
    DB::listen(function ($query) use (&$reads, &$writes): void {
        if (str_starts_with($query->sql, 'select `id`, `rank`, `number` from `work_items`')) {
            $reads[] = $query->sql;
        }
        if (str_starts_with($query->sql, 'update `work_items` set `rank`')) {
            $writes[] = count($query->bindings);
        }
    });

    expect(RedistributeRanks::run(actor($w['mara']), $w['web']))->toBe($count);

    $after = WorkItem::query()->where('project_id', $w['web']->id)->orderBy('rank')->orderBy('id')->get(['id', 'rank']);
    expect($after->pluck('id')->all())->toBe($before)
        ->and($after->pluck('rank')->all())->toBe($ranks)
        // two blocks over the index (`project_id`, `number`), the second after the last number of the first
        ->and($reads)->toHaveCount(2)
        ->and($reads[0])->toContain('order by `number` asc')
        ->and($reads[1])->toContain('`number` > ?')
        // one statement per block: 500 rows, then the one left over (three bindings per row)
        ->and($writes)->toBe([RedistributeRanks::BLOCK * 3, 3])
        ->and(eventsOf(EventType::ProjectRanksRedistributed)->sole()->meta['count'])->toBe($count);
});

it('counts only items whose rank changed and records nothing when none did', function () use ($world, $order) {
    $w = $world();
    [$first, $second, $third] = WorkItem::factory()->for($w['web'])->count(3)->create()->all();
    $ranks = Rank::nBetween(null, null, 3);
    DB::table('work_items')->where('id', $first->id)->update(['rank' => $ranks[0]]);
    DB::table('work_items')->where('id', $second->id)->update(['rank' => $ranks[1]]);
    DB::table('work_items')->where('id', $third->id)->update(['rank' => $ranks[2].'V']);

    expect(RedistributeRanks::run(actor($w['mara']), 'web'))->toBe(1)
        ->and($order($w['web']))->toBe([$first->id, $second->id, $third->id])
        ->and(DB::table('work_items')->where('id', $third->id)->value('rank'))->toBe($ranks[2])
        ->and(eventsOf(EventType::ProjectRanksRedistributed)->sole()->meta['count'])->toBe(1);

    // a second run finds every rank short: no write, no event
    expect(RedistributeRanks::run(actor($w['mara']), $w['web']))->toBe(0)
        ->and(eventsOf(EventType::ProjectRanksRedistributed))->toHaveCount(1);
});

it('takes archived items along', function () use ($world, $order) {
    $w = $world();
    $open = WorkItem::factory()->for($w['web'])->create();
    $archived = WorkItem::factory()->for($w['web'])->archived()->create();
    $last = WorkItem::factory()->for($w['web'])->create();
    DB::table('work_items')->where('id', $open->id)->update(['rank' => 'a0'.str_repeat('V', 100)]);
    DB::table('work_items')->where('id', $archived->id)->update(['rank' => 'a0'.str_repeat('V', 110)]);
    DB::table('work_items')->where('id', $last->id)->update(['rank' => 'a0'.str_repeat('V', 120)]);

    expect(RedistributeRanks::run(actor($w['jonas']), $w['web']))->toBe(3)
        ->and($order($w['web']))->toBe([$open->id, $archived->id, $last->id])
        ->and($archived->fresh()?->rank)->toBe(Rank::nBetween(null, null, 3)[1])
        ->and($archived->fresh()?->archived_at)->not->toBeNull();
});

it('leaves the items of other projects alone', function () use ($world) {
    $w = $world();
    $ops = Project::factory()->identifier('OPS')->member($w['mara'], ProjectRole::Admin)->create();
    $other = WorkItem::factory()->for($ops)->create();
    DB::table('work_items')->where('id', $other->id)->update(['rank' => 'a0VVV']);
    WorkItem::factory()->for($w['web'])->create(['rank' => 'a0VVV']);

    expect(RedistributeRanks::run(actor($w['mara']), $w['web']))->toBe(1)
        ->and(DB::table('work_items')->where('id', $other->id)->value('rank'))->toBe('a0VVV');
});

it('refuses a viewer and hides an invisible project', function () use ($world) {
    $w = $world();
    WorkItem::factory()->for($w['web'])->create(['rank' => 'a0VVV']);
    $secret = Project::factory()->identifier('SEC')->private()->member($w['mara'], ProjectRole::Admin)->create();

    $viewer = rescue(fn () => RedistributeRanks::run(actor($w['lene']), $w['web']), fn (Throwable $e) => $e, false);
    expect($viewer)->toBeInstanceOf(Problem::class)
        ->and($viewer instanceof Problem ? $viewer->getStatusCode() : null)->toBe(403)
        ->and($viewer instanceof Problem ? $viewer->detail : null)->toBe(__('problem.detail.items_members_only'));

    foreach ([$secret, 'SEC', 'NOPE'] as $reference) {
        $hidden = rescue(fn () => RedistributeRanks::run(actor($w['jonas']), $reference), fn (Throwable $e) => $e, false);
        expect($hidden)->toBeInstanceOf(Problem::class)
            ->and($hidden instanceof Problem ? $hidden->getStatusCode() : null)->toBe(404);
    }

    expect(DB::table('work_items')->where('project_id', $w['web']->id)->value('rank'))->toBe('a0VVV')
        ->and(eventsOf(EventType::ProjectRanksRedistributed))->toHaveCount(0);
});

it('refuses an archived project and one that is being deleted', function () use ($world) {
    $w = $world();
    $archived = Project::factory()->identifier('OLD')->archived()->member($w['mara'], ProjectRole::Admin)->create();
    WorkItem::factory()->for($archived)->create(['rank' => 'a0VVV']);

    $refusal = rescue(fn () => RedistributeRanks::run(actor($w['mara']), $archived), fn (Throwable $e) => $e, false);
    expect($refusal)->toBeInstanceOf(Problem::class)
        ->and($refusal instanceof Problem ? $refusal->getStatusCode() : null)->toBe(409)
        ->and($refusal instanceof Problem ? $refusal->reason : null)->toBe('project_archived')
        ->and(DB::table('work_items')->where('project_id', $archived->id)->value('rank'))->toBe('a0VVV');

    // read before the deletion began, as by a request at the same time
    $stale = Project::query()->findOrFail($w['web']->id);
    DB::table('projects')->where('id', $w['web']->id)->update(['deleting_at' => now()]);
    $gone = rescue(fn () => RedistributeRanks::run(actor($w['mara']), $stale), fn (Throwable $e) => $e, false);
    expect($gone)->toBeInstanceOf(Problem::class)
        ->and($gone instanceof Problem ? $gone->getStatusCode() : null)->toBe(404);
});

it('answers over REST with the number of items whose rank changed', function () use ($world) {
    $w = $world();
    WorkItem::factory()->for($w['web'])->count(2)->create();
    DB::table('work_items')->where('project_id', $w['web']->id)->update(['rank' => DB::raw("concat(`rank`, 'V')")]);

    $this->withToken(apiToken($w['jonas'], ['read', 'write']))->postJson('/api/v1/projects/web/redistribute-ranks')
        ->assertOk()
        ->assertExactJson(['redistributed' => 2]);

    forgetApiAuth();
    $this->withToken(apiToken($w['jonas'], ['read']))->postJson('/api/v1/projects/WEB/redistribute-ranks')
        ->assertForbidden();
});
