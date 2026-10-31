<?php

use App\Access\ProjectRole;
use App\Actions\WorkItems\TransitionWorkItem;
use App\Domain\Workflow\StateCategory;
use App\Events\EventType;
use App\Models\Project;
use App\Models\Resolution;
use App\Models\User;
use App\Models\Workflow;
use App\Models\WorkItem;
use App\Support\Actor;
use App\Support\ItemLock;
use Database\Seeders\Demo\CatalogSeeder;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;

/** WEB (the default workflow, free) with Mara as its admin and lead. */
$web = function (): array {
    $mara = User::factory()->create(['name' => 'Mara']);
    $web = Project::factory()->identifier('WEB')->member($mara, ProjectRole::Admin)->create(['lead_id' => $mara->id]);

    return [$web, $mara];
};

/** The id of the state of that name in the workflow of the project. */
$state = fn (Project $project, string $name): string => (string) $project->workflow()->firstOrFail()->states()->where('name', $name)->value('id');

$move = fn (User $user, WorkItem $item, string $to, mixed $resolution = null): WorkItem => TransitionWorkItem::run(actor($user), $item, ['to_state_id' => $to, 'resolution_id' => $resolution]);

$default = fn (StateCategory $category): string => (string) Resolution::query()->where('default_for', $category->value)->value('id');

it('refuses a transition the workflow does not allow and allows a listed one', function () use ($web, $state, $move) {
    [$project, $mara] = $web();
    $this->seed(CatalogSeeder::class);
    $project->update(['workflow_id' => Workflow::query()->where('name', 'Agentur-Freigabe')->value('id')]);
    $item = WorkItem::factory()->for($project)->inState('Todo')->create();

    $refused = problemOf(fn () => $move($mara, $item, $state($project, 'Done')));
    $moved = $move($mara, $item, $state($project, 'In Progress'));

    expect([$refused->status, $refused->reason])->toBe([409, 'transition_not_allowed'])
        ->and($refused->detail)->toBe(__('problem.detail.transition_not_allowed', ['from' => 'Todo', 'to' => 'Done', 'workflow' => 'Agentur-Freigabe']))
        ->and($refused->detail)->toContain('“Todo”')->toContain('“Done”')
        ->and($moved->state_id)->toBe($state($project, 'In Progress'))
        ->and($moved->relationLoaded('labels'))->toBeTrue()
        ->and(eventsOf(EventType::WorkItemStateChanged, $item))->toHaveCount(1);
});

it('takes the target as an upper-case ULID', function () use ($web, $state, $move) {
    [$project, $mara] = $web();
    $item = WorkItem::factory()->for($project)->create();

    expect($move($mara, $item, strtoupper($state($project, 'Todo')))->state_id)->toBe($state($project, 'Todo'));
});

it('sets the default resolution of Completed and of Canceled', function () use ($web, $state, $move, $default) {
    [$project, $mara] = $web();
    [$done, $cancelled] = WorkItem::factory()->for($project)->count(2)->create();

    expect($move($mara, $done, $state($project, 'Done'))->resolution_id)->toBe($default(StateCategory::Completed))
        ->and($move($mara, $cancelled, $state($project, 'Cancelled'))->resolution_id)->toBe($default(StateCategory::Canceled));
});

it('takes a chosen resolution and refuses an archived one', function () use ($web, $state, $move) {
    [$project, $mara] = $web();
    [$item, $other] = WorkItem::factory()->for($project)->count(2)->create();
    $duplicate = Resolution::query()->where('label', 'Duplicate')->firstOrFail();
    $archived = Resolution::factory()->create(['archived_at' => now()]);
    $done = $state($project, 'Done');
    $refuse = fn (mixed $resolution) => invalidOf(fn () => $move($mara, $other, $done, $resolution));

    expect($move($mara, $item, $done, strtoupper($duplicate->id))->resolution_id)->toBe($duplicate->id)
        ->and($refuse($archived->id))->toBe(['resolution_id' => [__('field.resolution_id.archived')]])
        ->and($refuse(strtolower((string) Str::ulid())))->toBe(['resolution_id' => [__('field.resolution_id.unknown')]])
        ->and($refuse(''))->toBe(['resolution_id' => [__('field.resolution_id.unknown')]])
        ->and($refuse(['x']))->toBe(['resolution_id' => [__('field.resolution_id.unknown')]])
        ->and($other->fresh()?->state_id)->toBe($state($project, 'Backlog'));
});

it('clears the resolution when the item is reopened', function () use ($web, $state, $move) {
    [$project, $mara] = $web();
    $item = WorkItem::factory()->for($project)->closed()->create();

    $reopened = $move($mara, $item, $state($project, 'Todo'));
    $event = eventsOf(EventType::WorkItemStateChanged, $item)->sole();

    expect($reopened->resolution_id)->toBeNull()
        ->and($reopened->closed_at)->toBeNull()
        ->and($event->changes['resolution_id'])->toBe(['old' => $item->resolution_id, 'new' => null]);
});

it('changes only the resolution of a closed item that stays', function () use ($web, $move) {
    [$project, $mara] = $web();
    $item = WorkItem::factory()->for($project)->closed()->create(['closed_at' => now()->subDay()]);
    $duplicate = Resolution::query()->where('label', 'Duplicate')->firstOrFail();

    $changed = $move($mara, $item, $item->state_id, $duplicate->id);
    $event = eventsOf(EventType::WorkItemUpdated, $item)->sole();

    expect($changed->resolution_id)->toBe($duplicate->id)
        ->and($changed->closed_at?->isYesterday())->toBeTrue()
        ->and($event->changes)->toBe(['resolution_id' => ['old' => $item->resolution_id, 'new' => $duplicate->id]])
        ->and(eventsOf(EventType::WorkItemStateChanged))->toHaveCount(0)
        ->and($project->workflow()->firstOrFail()->states()->whereKey($item->state_id)->value('name'))->toBe('Done');
});

it('does nothing when state and resolution stay', function () use ($web, $move) {
    [$project, $mara] = $web();
    $open = WorkItem::factory()->for($project)->create(['updated_at' => now()->subDay()]);
    $closed = WorkItem::factory()->for($project)->closed()->create(['updated_at' => now()->subDay()]);

    $move($mara, $open, $open->state_id);
    // a closed item that stays keeps its resolution, chosen again or not
    $move($mara, $closed, $closed->state_id);
    $move($mara, $closed, $closed->state_id, $closed->resolution_id);

    expect($open->fresh()?->updated_at?->isYesterday())->toBeTrue()
        ->and($closed->fresh()?->updated_at?->isYesterday())->toBeTrue()
        ->and($closed->fresh()?->resolution_id)->toBe($closed->resolution_id)
        ->and(eventsOf(EventType::WorkItemUpdated))->toHaveCount(0)
        ->and(eventsOf(EventType::WorkItemStateChanged))->toHaveCount(0);
});

it('stamps the first start and the closing, and clears the closing on reopening', function () use ($web, $state, $move) {
    [$project, $mara] = $web();
    $item = WorkItem::factory()->for($project)->create();

    $this->travelTo('2026-11-02 09:00:00');
    $started = $move($mara, $item, $state($project, 'In Progress'));
    $this->travelTo('2026-11-03 09:00:00');
    $pending = $move($mara, $item, $state($project, 'Pending'));
    $this->travelTo('2026-11-04 09:00:00');
    $done = $move($mara, $item, $state($project, 'Done'));
    $this->travelTo('2026-11-05 09:00:00');
    $cancelled = $move($mara, $item, $state($project, 'Cancelled'));
    $this->travelTo('2026-11-06 09:00:00');
    $reopened = $move($mara, $item, $state($project, 'Todo'));
    $this->travelTo('2026-11-07 09:00:00');
    $again = $move($mara, $item, $state($project, 'In Progress'));

    $stamps = fn (WorkItem $item) => [$item->started_at?->toDateTimeString(), $item->closed_at?->toDateTimeString()];
    expect($stamps($started))->toBe(['2026-11-02 09:00:00', null])
        ->and($stamps($pending))->toBe(['2026-11-02 09:00:00', null])
        ->and($stamps($done))->toBe(['2026-11-02 09:00:00', '2026-11-04 09:00:00'])
        ->and($stamps($cancelled))->toBe(['2026-11-02 09:00:00', '2026-11-05 09:00:00'])
        ->and($stamps($reopened))->toBe(['2026-11-02 09:00:00', null])
        ->and($stamps($again))->toBe(['2026-11-02 09:00:00', null])
        ->and($stamps($item->fresh()))->toBe(['2026-11-02 09:00:00', null])
        ->and($again->updated_at?->toDateTimeString())->toBe('2026-11-07 09:00:00');
});

it('refuses a state of another workflow', function () use ($web, $move) {
    [$project, $mara] = $web();
    $item = WorkItem::factory()->for($project)->create();
    $other = Workflow::factory()->create()->states()->value('id');
    $unknown = ['state_id' => [__('field.state_id.unknown')]];

    expect(invalidOf(fn () => $move($mara, $item, (string) $other)))->toBe($unknown)
        ->and(invalidOf(fn () => $move($mara, $item, 'Done')))->toBe($unknown)
        ->and(invalidOf(fn () => TransitionWorkItem::run(actor($mara), $item, [])))->toBe($unknown)
        ->and(invalidOf(fn () => TransitionWorkItem::run(actor($mara), $item, ['to_state_id' => ['x']])))->toBe($unknown)
        ->and(eventsOf(EventType::WorkItemStateChanged))->toHaveCount(0);
});

it('refuses an archived item and an item of an archived project', function () use ($web, $state, $move) {
    [$project, $mara] = $web();
    $archived = WorkItem::factory()->for($project)->archived()->create();
    $item = WorkItem::factory()->for($project)->create();

    $refused = problemOf(fn () => $move($mara, $archived, $state($project, 'Todo')));
    $project->update(['archived_at' => now()]);
    $readOnly = problemOf(fn () => $move($mara, $item, $state($project, 'Todo')));

    expect([$refused->status, $refused->reason, $refused->detail])->toBe([409, 'archived', __('problem.detail.item_archived', ['key' => $archived->key])])
        ->and([$readOnly->status, $readOnly->reason])->toBe([409, 'project_archived'])
        ->and($archived->fresh()?->state_id)->toBe($archived->state_id);
});

it('answers 403 to a viewer and 404 to an outsider of a private project', function () use ($state, $move) {
    $ops = Project::factory()->identifier('OPS')->private()->create();
    $viewer = memberOf($ops, ProjectRole::Viewer);
    $item = WorkItem::factory()->for($ops)->create();

    expect(problemOf(fn () => $move($viewer, $item, $state($ops, 'Todo')))->status)->toBe(403)
        ->and(problemOf(fn () => $move(User::factory()->create(), $item, $state($ops, 'Todo')))->status)->toBe(404);
});

it('records the move with old and new state', function () use ($web, $state, $move, $default) {
    [$project, $mara] = $web();
    $item = WorkItem::factory()->for($project)->create();

    $move($mara, $item, $state($project, 'Done'));
    $event = eventsOf(EventType::WorkItemStateChanged, $item)->sole();

    expect($event->changes)->toBe([
        'state_id' => ['old' => $state($project, 'Backlog'), 'new' => $state($project, 'Done')],
        'resolution_id' => ['old' => null, 'new' => $default(StateCategory::Completed)],
    ])
        ->and($event->actor_id)->toBe($mara->id)
        ->and($event->project_id)->toBe($project->id)
        ->and($event->meta['reason'])->toBeNull();
});

it('notes the reason of a move in its event', function () use ($web, $state) {
    [$project, $mara] = $web();
    $item = WorkItem::factory()->for($project)->create();

    $moved = DB::transaction(fn () => TransitionWorkItem::move(actor($mara), ItemLock::take($item), $state($project, 'Todo'), null, 'automation'));

    expect($moved)->toBeTrue()
        ->and(eventsOf(EventType::WorkItemStateChanged, $item)->sole()->meta['reason'])->toBe('automation')
        ->and(eventsOf(EventType::WorkItemStateChanged, $item)->sole()->meta['via'])->toBe(Actor::VIA_UI);
});
