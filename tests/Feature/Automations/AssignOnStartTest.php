<?php

use App\Access\ProjectRole;
use App\Access\RoleAssignments;
use App\Actions\Automations\RunMoveAutomations;
use App\Actions\WorkItems\BulkUpdateWorkItems;
use App\Actions\WorkItems\CreateWorkItem;
use App\Actions\WorkItems\TransitionWorkItem;
use App\Actions\WorkItems\UpdateWorkItem;
use App\Domain\Automations\AutomationKey;
use App\Events\EventType;
use App\Models\Automation;
use App\Models\Event;
use App\Models\Project;
use App\Models\User;
use App\Models\WorkflowState;
use App\Models\WorkItem;
use App\Models\WorkItemSubscriber;
use App\Support\Actor;

/*
 * "Assignee beim Start" (spec 4.13, A341, A342): a person who moves an item nobody has from a state that is not started
 * into a started one takes it. The default bot assigns it on behalf of the person (`meta.on_behalf_of`), with the
 * reason `assign_on_start`, after the move and in its transaction; the person watches the item like any new assignee.
 */

/** WEB (the default workflow, free) with Mara as its admin, Erik as a member and Assignee beim Start switched on. */
$world = function (bool $on = true): array {
    $mara = User::factory()->create(['name' => 'Mara']);
    $erik = User::factory()->create(['name' => 'Erik']);
    $web = Project::factory()->identifier('WEB')->member($mara, ProjectRole::Admin)->member($erik, ProjectRole::Member)->create(['lead_id' => $mara->id]);
    Automation::factory()->for($web)->key(AutomationKey::AssignOnStart)->create(['enabled' => $on]);

    return [$web, $mara, $erik];
};

$state = fn (Project $project, string $name): string => (string) $project->workflow()->firstOrFail()->states()->where('name', $name)->value('id');

$move = fn (User $user, WorkItem $item, string $to): WorkItem => TransitionWorkItem::run(actor($user), $item, ['to_state_id' => $to]);

it('a person who starts an item nobody has becomes its assignee', function () use ($world, $state, $move) {
    [$web, $mara, $erik] = $world();
    $item = WorkItem::factory()->for($web)->inState('Todo')->create(['created_by' => $mara->id]);
    WorkItemSubscriber::query()->create(['work_item_id' => $item->id, 'user_id' => $erik->id, 'reason' => 'manual', 'unsubscribed_at' => now()]);

    $moved = $move($erik, $item, $state($web, 'In Progress'));
    $assigned = eventsOf(EventType::WorkItemAssigned, $item)->sole();
    $types = Event::query()->where('subject_id', $item->id)->orderBy('occurred_at')->orderBy('id')->pluck('type')->map->value->all();

    expect($moved->assignee_id)->toBe($erik->id)
        ->and($item->fresh()->assignee_id)->toBe($erik->id)
        ->and($assigned->actor_id)->toBe(User::defaultBot()->id)
        ->and($assigned->changes)->toBe(['assignee_id' => ['old' => null, 'new' => $erik->id]])
        ->and($assigned->meta)->toMatchArray(['via' => Actor::VIA_AUTOMATION, 'reason' => 'assign_on_start', 'on_behalf_of' => $erik->id])
        ->and($types)->toBe(['work_item.state_changed', 'work_item.assigned'])
        ->and(WorkItemSubscriber::query()->where('work_item_id', $item->id)->where('user_id', $erik->id)->sole()->only(['reason', 'unsubscribed_at']))
        ->toBe(['reason' => 'assigned', 'unsubscribed_at' => null]);
});

it('not for a bot, not when assigned, not when off, not from started to started', function (string $case) use ($world, $state, $move) {
    [$web, $mara, $erik] = $world($case !== 'off');
    $bot = User::factory()->bot()->create();
    app(RoleAssignments::class)->setProjectRole($bot, $web, ProjectRole::Member);

    $item = WorkItem::factory()->for($web)->inState($case === 'started' ? 'In Progress' : 'Todo')
        ->create($case === 'assigned' ? ['assignee_id' => $mara->id] : []);
    $to = $state($web, $case === 'started' ? 'Pending' : 'In Progress');

    $moved = $move($case === 'bot' ? $bot : $erik, $item, $to);

    expect($moved->state_id)->toBe($to)
        ->and($moved->assignee_id)->toBe($case === 'assigned' ? $mara->id : null)
        ->and(eventsOf(EventType::WorkItemAssigned, $item))->toHaveCount(0);
})->with(['bot', 'assigned', 'off', 'started']);

it('not for a person who may not take work in the project', function () use ($world) {
    [$web] = $world();
    $stranger = User::factory()->create();
    $item = WorkItem::factory()->for($web)->inState('In Progress')->create();
    $states = WorkflowState::query()->whereIn('name', ['Todo', 'In Progress'])->where('workflow_id', $web->workflow_id)->get()->keyBy('name');

    RunMoveAutomations::run(actor($stranger), $item->load('project'), $states['Todo'], $states['In Progress']);

    expect($item->fresh()->assignee_id)->toBeNull()
        ->and(eventsOf(EventType::WorkItemAssigned, $item))->toHaveCount(0);
});

it('assigns nobody when the patch names an assignee with the move', function () use ($world, $state) {
    [$web, $mara, $erik] = $world();
    $item = WorkItem::factory()->for($web)->inState('Todo')->create();

    UpdateWorkItem::run(actor($erik), $item, ['state_id' => $state($web, 'In Progress'), 'assignee_id' => $mara->id]);

    expect($item->fresh()->assignee_id)->toBe($mara->id)
        ->and(eventsOf(EventType::WorkItemAssigned, $item)->sole()->actor_id)->toBe($erik->id);
});

it('also from the board\'s bulk move', function () use ($world, $state) {
    [$web, $mara, $erik] = $world();
    [$one, $two] = WorkItem::factory()->for($web)->inState('Backlog')->count(2)->create();

    $outcome = BulkUpdateWorkItems::run(actor($erik), ['ids' => [$one->id, $two->id], 'patch' => ['state_id' => $state($web, 'In Progress')]]);

    expect($outcome)->toBe(['updated' => [$one->id, $two->id], 'rejected' => []])
        ->and($one->fresh()->assignee_id)->toBe($erik->id)
        ->and($two->fresh()->assignee_id)->toBe($erik->id)
        ->and(eventsOf(EventType::WorkItemAssigned)->pluck('meta.on_behalf_of')->all())->toBe([$erik->id, $erik->id]);
});

it('creating an item in a started state assigns its creator, a template run never (K26)', function () use ($world, $state) {
    [$web, $mara, $erik] = $world();

    $byErik = CreateWorkItem::run(actor($erik), ['project_id' => $web->id, 'title' => 'Gleich los', 'state_id' => $state($web, 'In Progress')]);
    $byBot = CreateWorkItem::run(Actor::automation('template'), ['project_id' => $web->id, 'title' => 'Vom Bot', 'state_id' => $state($web, 'In Progress')]);

    expect($byErik->fresh()->assignee_id)->toBe($erik->id)
        ->and(eventsOf(EventType::WorkItemAssigned, $byErik)->sole()->meta['on_behalf_of'])->toBe($erik->id)
        ->and($byBot->fresh()->assignee_id)->toBeNull()
        ->and(eventsOf(EventType::WorkItemAssigned, $byBot))->toHaveCount(0);
});
