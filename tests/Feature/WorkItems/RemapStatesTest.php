<?php

use App\Access\ProjectRole;
use App\Actions\Workflows\SaveWorkflow;
use App\Actions\WorkItems\RemapStates;
use App\Domain\Workflow\StateCategory;
use App\Events\EventType;
use App\Models\Event;
use App\Models\Project;
use App\Models\Resolution;
use App\Models\User;
use App\Models\Workflow;
use App\Models\WorkItem;
use App\Support\Actor;
use Tests\Support\WorkflowFixtures;

/*
 * RemapStates moves the items of projects out of states that go away (AssignWorkflow, SaveWorkflow): without asking the
 * transitions, with the resolution and the stamps of a move and an event per item. The callers check rights and hold
 * the locks; here it runs on its own (in the test transaction).
 */

/** WEB (the default workflow) with Mara as its admin. */
$web = function (): array {
    $mara = User::factory()->create(['name' => 'Mara']);
    $web = Project::factory()->identifier('WEB')->member($mara, ProjectRole::Admin)->create(['lead_id' => $mara->id]);

    return [$web, $mara];
};

/** The id of the state of that name in the workflow of the project. */
$state = fn (Project $project, string $name): string => (string) $project->workflow()->firstOrFail()->states()->where('name', $name)->value('id');

it('moves items without asking the transitions', function () use ($state) {
    $mara = User::factory()->create();
    // Backlog → Doing only: Backlog → Done is no transition of the workflow
    $workflow = Workflow::factory()->matrix([[0, 1], [1, 2]])->create();
    $project = Project::factory()->identifier('WEB')->member($mara, ProjectRole::Admin)->create(['workflow_id' => $workflow->id]);
    $item = WorkItem::factory()->for($project)->create();

    $moved = RemapStates::run(actor($mara), [$project->id], [$state($project, 'Backlog') => $state($project, 'Done')], RemapStates::STATE_REMOVED);

    expect($moved)->toBe(1)
        ->and($workflow->graph()->canTransition($state($project, 'Backlog'), $state($project, 'Done')))->toBeFalse()
        ->and($item->fresh()?->state_id)->toBe($state($project, 'Done'));
});

it('sets the resolution and the stamps like a move', function () use ($web, $state) {
    [$project, $mara] = $web();
    $this->travelTo('2026-10-31 09:00:00');
    $started = WorkItem::factory()->for($project)->inState('In Progress')->create(['started_at' => now()->subDay()]);
    $todo = WorkItem::factory()->for($project)->inState('Todo')->create();
    $done = WorkItem::factory()->for($project)->closed()->create(['started_at' => now()->subDays(3), 'closed_at' => now()->subDay()]);
    $this->travelTo('2026-10-31 10:00:00');

    RemapStates::run(actor($mara), [$project->id], [
        $state($project, 'In Progress') => $state($project, 'Done'),
        $state($project, 'Todo') => $state($project, 'Pending'),
        $state($project, 'Done') => $state($project, 'Todo'),
    ], RemapStates::WORKFLOW_CHANGED);

    $started->refresh();
    $todo->refresh();
    $done->refresh();

    expect([$started->state_id, $started->resolution_id])->toBe([$state($project, 'Done'), Resolution::query()->where('default_for', StateCategory::Completed->value)->value('id')])
        ->and($started->closed_at?->toDateTimeString())->toBe('2026-10-31 10:00:00')
        ->and($started->started_at?->toDateTimeString())->toBe('2026-10-30 09:00:00')
        ->and($started->updated_at?->toDateTimeString())->toBe('2026-10-31 10:00:00')
        // into Started for the first time: started now
        ->and($todo->started_at?->toDateTimeString())->toBe('2026-10-31 10:00:00')
        ->and([$todo->state_id, $todo->resolution_id, $todo->closed_at])->toBe([$state($project, 'Pending'), null, null])
        // reopened: no resolution, no longer closed, started as before
        ->and([$done->state_id, $done->resolution_id, $done->closed_at])->toBe([$state($project, 'Todo'), null, null])
        ->and($done->started_at?->toDateTimeString())->toBe('2026-10-28 09:00:00');
});

it('records each item with the person and the reason', function () use ($web, $state) {
    [$project, $mara] = $web();
    [$first, $second] = WorkItem::factory()->for($project)->inState('Todo')->count(2)->create();
    $closed = WorkItem::factory()->for($project)->closed()->create();
    $resolution = $closed->resolution_id;

    RemapStates::run(actor($mara, Actor::VIA_API), [$project->id], [
        $state($project, 'Todo') => $state($project, 'Backlog'),
        $state($project, 'Done') => $state($project, 'Cancelled'),
    ], RemapStates::STATE_REMOVED);

    $events = eventsOf(EventType::WorkItemStateChanged);
    $event = eventsOf(EventType::WorkItemStateChanged, $first)->sole();

    expect($events)->toHaveCount(3)
        ->and($events->pluck('subject_id')->sort()->values()->all())->toBe(collect([$first->id, $second->id, $closed->id])->sort()->values()->all())
        ->and($event->actor_id)->toBe($mara->id)
        ->and($event->project_id)->toBe($project->id)
        ->and($event->meta)->toMatchArray(['via' => Actor::VIA_API, 'reason' => 'state_removed'])
        ->and($event->changes)->toBe(['state_id' => ['old' => $state($project, 'Todo'), 'new' => $state($project, 'Backlog')]])
        ->and($event->meta['states'])->toBe([
            'old' => ['id' => $state($project, 'Todo'), 'name' => 'Todo', 'category' => 'unstarted'],
            'new' => ['id' => $state($project, 'Backlog'), 'name' => 'Backlog', 'category' => 'backlog'],
        ])
        ->and(eventsOf(EventType::WorkItemStateChanged, $closed)->sole()->changes)->toBe([
            'state_id' => ['old' => $state($project, 'Done'), 'new' => $state($project, 'Cancelled')],
            'resolution_id' => ['old' => $resolution, 'new' => Resolution::query()->where('default_for', StateCategory::Canceled->value)->value('id')],
        ])
        ->and(eventsOf(EventType::WorkItemUpdated))->toBeEmpty();
});

it('leaves items of other projects and unmapped states alone', function () use ($web, $state) {
    [$project, $mara] = $web();
    $other = Project::factory()->identifier('OPS')->create();
    $mapped = WorkItem::factory()->for($project)->inState('Todo')->create();
    $unmapped = WorkItem::factory()->for($project)->inState('In Progress')->create();
    $elsewhere = WorkItem::factory()->for($other)->inState('Todo')->create();

    $moved = RemapStates::run(actor($mara), [$project->id], [$state($project, 'Todo') => $state($project, 'Pending')], RemapStates::WORKFLOW_CHANGED);

    expect($moved)->toBe(1)
        ->and($mapped->fresh()?->state_id)->toBe($state($project, 'Pending'))
        ->and($unmapped->fresh()?->state_id)->toBe($state($project, 'In Progress'))
        ->and($elsewhere->fresh()?->state_id)->toBe($state($other, 'Todo'))
        ->and($elsewhere->fresh()?->updated_at?->eq($elsewhere->updated_at))->toBeTrue()
        ->and(eventsOf(EventType::WorkItemStateChanged))->toHaveCount(1);
});

it('remaps archived items as well, which stay archived even in an open state', function () use ($web, $state) {
    [$project, $mara] = $web();
    $archived = WorkItem::factory()->for($project)->archived()->create();
    $stamp = $archived->archived_at?->toDateTimeString();

    $moved = RemapStates::run(actor($mara), [$project->id], [$state($project, 'Done') => $state($project, 'Todo')], RemapStates::WORKFLOW_CHANGED);
    $archived->refresh();

    expect($moved)->toBe(1)
        ->and([$archived->state_id, $archived->resolution_id, $archived->closed_at])->toBe([$state($project, 'Todo'), null, null])
        ->and($archived->archived_at?->toDateTimeString())->toBe($stamp)
        ->and(eventsOf(EventType::WorkItemStateChanged, $archived)->sole()->meta['reason'])->toBe('workflow_changed');
});

it('moves the items in blocks, every one of them once', function () use ($web, $state) {
    [$project, $mara] = $web();
    WorkItem::factory()->for($project)->inState('Todo')->count(RemapStates::BLOCK + 1)->create();

    // the block after the first must not skip the items the first one left (it reads by id, not by offset)
    $moved = RemapStates::run(actor($mara), [$project->id], [$state($project, 'Todo') => $state($project, 'Backlog')], RemapStates::STATE_REMOVED);

    expect($moved)->toBe(RemapStates::BLOCK + 1)
        ->and(WorkItem::query()->where('state_id', $state($project, 'Backlog'))->count())->toBe(RemapStates::BLOCK + 1)
        ->and(eventsOf(EventType::WorkItemStateChanged))->toHaveCount(RemapStates::BLOCK + 1);
});

it('moves nothing without a mapping', function () use ($web) {
    [$project, $mara] = $web();
    WorkItem::factory()->for($project)->create();

    expect(RemapStates::run(actor($mara), [$project->id], [], RemapStates::WORKFLOW_CHANGED))->toBe(0)
        ->and(eventsOf(EventType::WorkItemStateChanged))->toBeEmpty();
});

it('rewrites the items of a project being deleted without recording events for them', function () use ($web, $state) {
    [$project] = $web();
    $admin = User::factory()->admin()->create();
    $gone = Project::factory()->identifier('OLD')->create(['deleting_at' => now()]);
    $live = WorkItem::factory()->for($project)->inState('Pending')->create();
    $purged = WorkItem::factory()->for($gone)->inState('Pending')->create();
    $input = WorkflowFixtures::inputOf(Workflow::default());
    $pending = $state($project, 'Pending');
    $todo = $state($project, 'Todo');
    $input['states'] = array_values(array_filter($input['states'], fn (array $row) => $row['id'] !== $pending));

    SaveWorkflow::run(actor($admin), Workflow::default(), [...$input, 'state_mapping' => [$pending => $todo]]);

    // the purge takes the project with its items; an event of its own would stay in the history without a subject
    expect($live->fresh()?->state_id)->toBe($todo)
        ->and($purged->fresh()?->state_id)->toBe($todo)
        ->and(eventsOf(EventType::WorkItemStateChanged)->pluck('subject_id')->all())->toBe([$live->id])
        ->and(Event::query()->where('subject_id', $purged->id)->exists())->toBeFalse();
});
