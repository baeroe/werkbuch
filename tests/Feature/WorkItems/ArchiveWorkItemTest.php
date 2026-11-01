<?php

use App\Access\ProjectRole;
use App\Actions\Projects\ArchiveProject;
use App\Actions\WorkItems\ArchiveWorkItem;
use App\Actions\WorkItems\ChangeWorkItemType;
use App\Actions\WorkItems\RestoreWorkItem;
use App\Actions\WorkItems\TransitionWorkItem;
use App\Actions\WorkItems\UpdateWorkItem;
use App\Events\EventType;
use App\Models\Project;
use App\Models\User;
use App\Models\WorkItem;
use App\Models\WorkItemType;
use App\Support\ItemLock;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;

/** WEB (the default workflow) with Mara as its admin and lead. */
$web = function (): array {
    $mara = User::factory()->create(['name' => 'Mara']);
    $web = Project::factory()->identifier('WEB')->member($mara, ProjectRole::Admin)->create(['lead_id' => $mara->id]);

    return [$web, $mara];
};

it('archives a closed item only', function () use ($web) {
    [$project, $mara] = $web();
    $open = WorkItem::factory()->for($project)->inState('In Progress')->create();
    $done = WorkItem::factory()->for($project)->closed()->create();
    $cancelled = WorkItem::factory()->for($project)->inState('Cancelled')->create();
    Carbon::setTestNow('2026-11-02 09:30:00');

    $refused = problemOf(fn () => ArchiveWorkItem::run(actor($mara), $open));
    $archived = ArchiveWorkItem::run(actor($mara), $done);

    expect([$refused->status, $refused->reason, $refused->detail])->toBe([409, 'not_closed', __('problem.detail.not_closed')])
        ->and($open->fresh()?->archived_at)->toBeNull()
        ->and(eventsOf(EventType::WorkItemArchived, $open))->toHaveCount(0)
        ->and($archived->archived_at?->toJSON())->toBe('2026-11-02T09:30:00.000000Z')
        ->and($archived->updated_at?->toJSON())->toBe('2026-11-02T09:30:00.000000Z')
        ->and($archived->relationLoaded('labels'))->toBeTrue()
        ->and(eventsOf(EventType::WorkItemArchived, $done)->sole()->changes)->toBe(['archived_at' => ['old' => null, 'new' => '2026-11-02T09:30:00.000000Z']])
        ->and(ArchiveWorkItem::run(actor($mara), $cancelled)->archived_at)->not->toBeNull();
});

it('does nothing for an archived item', function () use ($web) {
    [$project, $mara] = $web();
    $item = WorkItem::factory()->for($project)->archived()->create(['updated_at' => '2026-10-01 08:00:00']);
    $stamp = $item->fresh()?->archived_at?->toJSON();

    $again = ArchiveWorkItem::run(actor($mara), $item);

    expect($again->archived_at?->toJSON())->toBe($stamp)
        ->and($item->fresh()?->updated_at?->toJSON())->toBe('2026-10-01T08:00:00.000000Z')
        ->and(eventsOf(EventType::WorkItemArchived, $item))->toHaveCount(0);
});

it('restores an archived item and refuses one that is not', function () use ($web) {
    [$project, $mara] = $web();
    Carbon::setTestNow('2026-11-01 10:00:00');
    $item = WorkItem::factory()->for($project)->archived()->create();
    $open = WorkItem::factory()->for($project)->create();
    Carbon::setTestNow('2026-11-02 11:00:00');

    $restored = RestoreWorkItem::run(actor($mara), $item);
    $refused = problemOf(fn () => RestoreWorkItem::run(actor($mara), $open));

    expect($restored->archived_at)->toBeNull()
        ->and($restored->updated_at?->toJSON())->toBe('2026-11-02T11:00:00.000000Z')
        ->and($restored->closed_at)->not->toBeNull()
        ->and(eventsOf(EventType::WorkItemRestored, $item)->sole()->changes)->toBe(['archived_at' => ['old' => '2026-11-01T10:00:00.000000Z', 'new' => null]])
        ->and([$refused->status, $refused->reason, $refused->detail])->toBe([409, 'not_archived', __('problem.detail.not_archived', ['key' => 'WEB-2'])])
        ->and(eventsOf(EventType::WorkItemRestored, $open))->toHaveCount(0);
});

it('keeps an archived item read-only until it is restored', function () use ($web) {
    [$project, $mara] = $web();
    $item = WorkItem::factory()->for($project)->archived()->create();
    $doing = (string) $project->workflow()->firstOrFail()->states()->where('name', 'In Progress')->value('id');
    $bug = (string) WorkItemType::query()->where('name', 'Bug')->value('id');
    $refusals = fn () => collect([
        problemOf(fn () => UpdateWorkItem::run(actor($mara), $item, ['title' => 'Neu'])),
        problemOf(fn () => TransitionWorkItem::run(actor($mara), $item, ['to_state_id' => $doing])),
        problemOf(fn () => ChangeWorkItemType::run(actor($mara), $item, ['type_id' => $bug])),
    ])->map(fn ($problem) => [$problem->status, $problem->reason, $problem->detail])->all();

    $archived = $refusals();
    RestoreWorkItem::run(actor($mara), $item);

    expect($archived)->toBe(array_fill(0, 3, [409, 'archived', __('problem.detail.item_archived', ['key' => 'WEB-1'])]))
        ->and(UpdateWorkItem::run(actor($mara), $item, ['title' => 'Neu'])->title)->toBe('Neu');
});

it('refuses both in an archived project', function () use ($web) {
    [$project, $mara] = $web();
    $closed = WorkItem::factory()->for($project)->closed()->create();
    $archived = WorkItem::factory()->for($project)->archived()->create();
    ArchiveProject::run(actor($mara), $project, true);

    foreach ([fn () => ArchiveWorkItem::run(actor($mara), $closed), fn () => RestoreWorkItem::run(actor($mara), $archived)] as $call) {
        $refused = problemOf($call);
        expect([$refused->status, $refused->reason])->toBe([409, 'project_archived']);
    }
    expect($closed->fresh()?->archived_at)->toBeNull()
        ->and($archived->fresh()?->archived_at)->not->toBeNull();
});

it('lets members archive and restore, and refuses viewers', function () use ($web) {
    [$project] = $web();
    $member = memberOf($project, ProjectRole::Member);
    $viewer = memberOf($project, ProjectRole::Viewer);
    $item = WorkItem::factory()->for($project)->closed()->create();

    $refused = problemOf(fn () => ArchiveWorkItem::run(actor($viewer), $item));

    expect([$refused->status, $refused->detail])->toBe([403, __('problem.detail.items_members_only')])
        ->and(ArchiveWorkItem::run(actor($member), $item)->archived_at)->not->toBeNull()
        ->and(RestoreWorkItem::run(actor($member), $item)->archived_at)->toBeNull();
});

it('applies to an item the caller has locked, saying whether it changed', function () use ($web) {
    [$project, $mara] = $web();
    $item = WorkItem::factory()->for($project)->closed()->create();

    $changes = DB::transaction(fn () => [
        ArchiveWorkItem::apply(actor($mara), $locked = ItemLock::take($item)),
        ArchiveWorkItem::apply(actor($mara), $locked),
        RestoreWorkItem::apply(actor($mara), $locked),
    ]);

    expect($changes)->toBe([true, false, true])
        ->and($item->fresh()?->archived_at)->toBeNull();
});
