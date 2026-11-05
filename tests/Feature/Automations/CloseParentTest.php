<?php

use App\Access\ProjectRole;
use App\Actions\Automations\RunMoveAutomations;
use App\Actions\WorkItems\CreateWorkItem;
use App\Actions\WorkItems\ListHistory;
use App\Actions\WorkItems\RemapStates;
use App\Actions\WorkItems\TransitionWorkItem;
use App\Domain\Automations\AutomationKey;
use App\Domain\Automations\CloseParentRule;
use App\Domain\Workflow\StateCategory;
use App\Domain\Workflow\StateIcon;
use App\Events\EventType;
use App\Http\Resources\HistoryEntryResource;
use App\Models\Automation;
use App\Models\Notification;
use App\Models\Project;
use App\Models\Resolution;
use App\Models\User;
use App\Models\Workflow;
use App\Models\WorkflowState;
use App\Models\WorkflowTransition;
use App\Models\WorkItem;
use App\Models\WorkItemSubscriber;
use App\Notifications\NotificationConsumer;
use App\Support\Actor;
use App\Support\ItemLock;
use Illuminate\Support\Facades\DB;

/*
 * "Eltern schließen" (spec 4.13, A341, A342): when a child closes and every child of its parent is closed with at least
 * one of them completed, the default bot moves the parent into the first Completed state of its workflow that it may
 * move to, on behalf of the person who closed the child; without such a move the parent stays open. In the transaction
 * of the move, after it.
 */

/** WEB with Mara as its admin, Erik as a member, Eltern schließen switched on (or off) and an epic with two open children. */
$world = function (bool $on = true, ?Workflow $workflow = null, string $open = 'Todo'): array {
    $mara = User::factory()->create(['name' => 'Mara']);
    $erik = User::factory()->create(['name' => 'Erik']);
    $web = Project::factory()->identifier('WEB')->member($mara, ProjectRole::Admin)->member($erik, ProjectRole::Member)
        ->create(['lead_id' => $mara->id] + ($workflow === null ? [] : ['workflow_id' => $workflow->id]));
    Automation::factory()->for($web)->key(AutomationKey::CloseParent)->create(['enabled' => $on]);
    $epic = WorkItem::factory()->for($web)->epic()->inState('Backlog')->create(['created_by' => $mara->id]);
    [$first, $second] = WorkItem::factory()->childOf($epic)->inState($open)->count(2)->create(['created_by' => $mara->id]);

    return [$web, $mara, $erik, $epic, $first, $second];
};

$state = fn (Project $project, string $name): string => (string) $project->workflow()->firstOrFail()->states()->where('name', $name)->value('id');

$move = fn (User $user, WorkItem $item, string $to): WorkItem => TransitionWorkItem::run(actor($user), $item, ['to_state_id' => $to]);

/**
 * A workflow with Backlog, Doing, Shipped and Done (both Completed, in this order) and Dropped (Canceled), with only
 * these moves (pairs of names).
 *
 * @param  list<array{0: string, 1: string}>  $pairs
 */
$matrix = function (array $pairs): Workflow {
    $workflow = Workflow::factory()->create(['is_free' => false]);
    $workflow->states()->where('name', 'Done')->update(['position' => 3]);
    $workflow->states()->create(['name' => 'Shipped', 'icon' => StateIcon::Check, 'category' => StateCategory::Completed, 'position' => 2]);
    $workflow->states()->create(['name' => 'Dropped', 'icon' => StateIcon::Cross, 'category' => StateCategory::Canceled, 'position' => 4]);
    $ids = $workflow->states()->pluck('id', 'name');

    foreach ($pairs as [$from, $to]) {
        WorkflowTransition::query()->create(['workflow_id' => $workflow->id, 'from_state_id' => $ids[$from], 'to_state_id' => $ids[$to]]);
    }

    return $workflow;
};

it('closes the epic when its last open child is done', function () use ($world, $state, $move) {
    [$web, $mara, $erik, $epic, $first, $second] = $world();
    $move($mara, $first, $state($web, 'Cancelled'));
    expect($epic->fresh()->state_id)->toBe($state($web, 'Backlog'));

    $move($erik, $second, $state($web, 'Done'));
    $closed = eventsOf(EventType::WorkItemStateChanged, $epic)->sole();
    $history = collect(ListHistory::run(actor($mara), $epic, [])->page->items())->map(fn ($e) => (new HistoryEntryResource($e))->resolve())->last();

    expect($epic->fresh()->only(['state_id', 'resolution_id']))
        ->toBe(['state_id' => $state($web, 'Done'), 'resolution_id' => Resolution::query()->where('default_for', 'completed')->value('id')])
        ->and($epic->fresh()->closed_at)->not->toBeNull()
        ->and($closed->actor_id)->toBe(User::defaultBot()->id)
        ->and($closed->meta)->toMatchArray(['via' => Actor::VIA_AUTOMATION, 'reason' => 'close_parent', 'on_behalf_of' => $erik->id])
        ->and($history)->toMatchArray(['type' => 'work_item.state_changed', 'reason' => 'close_parent', 'via' => 'automation', 'actor_id' => User::defaultBot()->id]);
});

it('takes the first Completed state the workflow lets the epic move to', function () use ($world, $matrix, $state, $move) {
    [$web, $mara, , $epic, $first, $second] = $world(workflow: $matrix([['Doing', 'Shipped'], ['Backlog', 'Done']]), open: 'Doing');

    $move($mara, $first, $state($web, 'Shipped'));
    $move($mara, $second, $state($web, 'Shipped'));

    expect($epic->fresh()->state_id)->toBe($state($web, 'Done'));
});

it('not when the workflow forbids the move, the epic stays open', function () use ($world, $matrix, $state, $move) {
    [$web, $mara, , $epic, $first, $second] = $world(workflow: $matrix([['Doing', 'Shipped']]), open: 'Doing');

    $move($mara, $first, $state($web, 'Shipped'));
    $move($mara, $second, $state($web, 'Shipped'));

    expect($epic->fresh()->state_id)->toBe($state($web, 'Backlog'))
        ->and(eventsOf(EventType::WorkItemStateChanged, $epic))->toHaveCount(0)
        ->and($second->fresh()->state_id)->toBe($state($web, 'Shipped'));
});

it('not when all children are canceled', function () use ($world, $state, $move) {
    [$web, $mara, , $epic, $first, $second] = $world();

    $move($mara, $first, $state($web, 'Cancelled'));
    $move($mara, $second, $state($web, 'Cancelled'));

    expect($epic->fresh()->state_id)->toBe($state($web, 'Backlog'))
        ->and(eventsOf(EventType::WorkItemStateChanged, $epic))->toHaveCount(0);
});

it('not while a child is open', function () use ($world, $state, $move) {
    [$web, $mara, , $epic, $first] = $world();

    $move($mara, $first, $state($web, 'Done'));

    expect($epic->fresh()->state_id)->toBe($state($web, 'Backlog'));
});

it('not for an archived epic', function () use ($world, $state, $move) {
    [$web, $mara, , $epic, $first, $second] = $world();
    // an archived item in an open state: a rebuilt workflow moves archived items as well (K24)
    $epic->update(['archived_at' => now()]);

    $move($mara, $first, $state($web, 'Done'));
    $move($mara, $second, $state($web, 'Done'));

    expect($epic->fresh()->state_id)->toBe($state($web, 'Backlog'))
        ->and($second->fresh()->state_id)->toBe($state($web, 'Done'))
        ->and(eventsOf(EventType::WorkItemStateChanged, $epic))->toHaveCount(0);
});

it('not when off', function () use ($world, $state, $move) {
    [$web, $mara, , $epic, $first, $second] = $world(false);

    $move($mara, $first, $state($web, 'Done'));
    $move($mara, $second, $state($web, 'Done'));

    expect($epic->fresh()->state_id)->toBe($state($web, 'Backlog'));
});

it('not for another resolution in the same state', function () use ($world, $state) {
    [$web, $mara, , $epic, $first, $second] = $world(open: 'Done');
    $duplicate = Resolution::query()->where('label', 'Duplicate')->value('id');

    TransitionWorkItem::run(actor($mara), $first, ['to_state_id' => $state($web, 'Done'), 'resolution_id' => $duplicate]);

    expect($first->fresh()->resolution_id)->toBe($duplicate)
        ->and($epic->fresh()->state_id)->toBe($state($web, 'Backlog'));
});

it('closing a child by Auto-Close counts too', function () use ($world, $state, $move) {
    [$web, $mara, , $epic, $first, $second] = $world();
    $move($mara, $first, $state($web, 'Done'));

    DB::transaction(function () use ($second, $state, $web) {
        TransitionWorkItem::move(Actor::automation('auto_close'), ItemLock::take($second), $state($web, 'Cancelled'), null);
    });
    $closed = eventsOf(EventType::WorkItemStateChanged, $epic)->sole();

    expect($epic->fresh()->state_id)->toBe($state($web, 'Done'))
        ->and($closed->actor_id)->toBe(User::defaultBot()->id)
        ->and($closed->meta['reason'])->toBe('close_parent')
        ->and($closed->meta)->not->toHaveKey('on_behalf_of');
});

it('acts for the person an automation acted for', function () use ($world, $state) {
    [$web, , $erik, $epic, $first, $second] = $world();
    $first->update(['state_id' => $state($web, 'Done')]);

    DB::transaction(function () use ($second, $state, $web, $erik) {
        TransitionWorkItem::move(Actor::automation('template')->onBehalfOf($erik), ItemLock::take($second), $state($web, 'Done'), null);
    });

    expect(eventsOf(EventType::WorkItemStateChanged, $epic)->sole()->meta)->toMatchArray(['reason' => 'close_parent', 'on_behalf_of' => $erik->id]);
});

it('creating the last child straight in Done closes the epic (K26)', function () use ($world, $state) {
    [$web, , $erik, $epic, $first, $second] = $world();
    // closed before the automation was on: the epic stayed open
    $first->update(['state_id' => $state($web, 'Done')]);
    $second->update(['state_id' => $state($web, 'Cancelled')]);

    CreateWorkItem::run(actor($erik), ['project_id' => $web->id, 'title' => 'Nachzügler', 'parent_id' => $epic->id, 'state_id' => $state($web, 'Done')]);

    expect($epic->fresh()->state_id)->toBe($state($web, 'Done'))
        ->and(eventsOf(EventType::WorkItemStateChanged, $epic)->sole()->meta['on_behalf_of'])->toBe($erik->id);
});

it('reaches no further up than its chain allows', function () use ($world, $state) {
    [$web, $mara, , $epic, $first, $second] = $world();
    $first->update(['state_id' => $state($web, 'Done')]);
    $second->update(['state_id' => $state($web, 'Done')]);
    $states = WorkflowState::query()->where('workflow_id', $web->workflow_id)->get()->keyBy('name');

    RunMoveAutomations::run(actor($mara), $second->load('project'), $states['Todo'], $states['Done'], CloseParentRule::MAX_CHAIN);
    expect($epic->fresh()->state_id)->toBe($state($web, 'Backlog'));

    RunMoveAutomations::run(actor($mara), $second->load('project'), $states['Todo'], $states['Done'], CloseParentRule::MAX_CHAIN - 1);
    expect($epic->fresh()->state_id)->toBe($state($web, 'Done'));
});

it('a rebuilt workflow closes no parent', function () use ($world, $state) {
    [$web, , , $epic, $first, $second] = $world();

    RemapStates::run(Actor::automation('matrix'), [$web->id], [$state($web, 'Todo') => $state($web, 'Done')], RemapStates::STATE_REMOVED);

    expect($first->fresh()->state_id)->toBe($state($web, 'Done'))
        ->and($second->fresh()->state_id)->toBe($state($web, 'Done'))
        ->and($epic->fresh()->state_id)->toBe($state($web, 'Backlog'));
});

it('tells a watcher of the epic, not the person who closed the last child', function () use ($world, $state, $move) {
    consumers(NotificationConsumer::class);
    [$web, $mara, $erik, $epic, $first, $second] = $world();
    WorkItemSubscriber::query()->create(['work_item_id' => $epic->id, 'user_id' => $erik->id, 'reason' => 'manual']);
    $move($erik, $first, $state($web, 'Done'));

    $move($mara, $second, $state($web, 'Done'));
    $told = Notification::query()->where('work_item_id', $epic->id)->where('kind', 'state_changed')->pluck('user_id')->all();

    expect($epic->fresh()->state_id)->toBe($state($web, 'Done'))
        ->and($told)->toBe([$erik->id]);
});
