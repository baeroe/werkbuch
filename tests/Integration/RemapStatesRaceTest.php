<?php

use App\Access\ProjectRole;
use App\Actions\Projects\AssignWorkflow;
use App\Actions\Workflows\SaveWorkflow;
use App\Actions\WorkItems\TransitionWorkItem;
use App\Models\Project;
use App\Models\User;
use App\Models\Workflow;
use App\Models\WorkflowState;
use App\Models\WorkItem;
use Illuminate\Database\QueryException;
use Illuminate\Validation\ValidationException;
use Tests\Support\RaceConnections;
use Tests\Support\WorkflowFixtures;

/*
 * A workflow changes while someone moves an item (Review Focus 3): AssignWorkflow and SaveWorkflow hold the
 * organization `for update` while RemapStates moves the items, every move of an item takes it shared first
 * (ItemLock::take). So the move waits for the change of the workflow and then checks against what it left: no item ends
 * up in a state outside the workflow of its project, and no move fails with a 500 on a foreign key. `mariadb` holds its
 * transaction open like a request in progress, `mariadb_second` is the other request and gives up waiting for a lock
 * after one second.
 */

beforeEach(fn () => RaceConnections::setUp());

afterEach(fn () => RaceConnections::tearDown());

/** WEB on the default workflow with Mara as its admin, Lene as a member and an item in Todo; an agency workflow. */
$world = function (): array {
    $mara = User::factory()->admin()->create(['name' => 'Mara']);
    $web = Project::factory()->identifier('WEB')->member($mara, ProjectRole::Admin)->create(['lead_id' => $mara->id]);
    $lene = memberOf($web, ProjectRole::Member, ['name' => 'Lene']);
    $item = WorkItem::factory()->for($web)->inState('Todo')->create(['created_by' => $mara->id]);

    return [$web, $item, $mara, $lene, Workflow::factory()->create(['name' => 'Agentur-Freigabe'])];
};

/** The id of the state of that name in the workflow. */
$stateOf = fn (Workflow $workflow, string $name): string => (string) $workflow->states()->where('name', $name)->value('id');

/** The switch of WEB to the agency workflow, Todo → Doing. */
$switch = fn (User $mara, Project $web, Workflow $agency) => AssignWorkflow::run(actor($mara), $web, [
    'workflow_id' => $agency->id,
    'mapping' => [$stateOf(Workflow::default(), 'Todo') => $stateOf($agency, 'Doing')],
]);

/** The default workflow without Pending (and the id of Pending), as an admin sends it back. */
$withoutPending = function (): array {
    $input = WorkflowFixtures::inputOf(Workflow::default());
    $pending = $input['states'][3]['id'];
    $input['states'] = array_values(array_filter($input['states'], fn (array $state) => $state['id'] !== $pending));

    return [$input, $pending];
};

it('makes a move wait while the workflow of the project changes', function () use ($world, $stateOf, $switch) {
    [$web, $item, $mara, $lene, $agency] = $world();
    $progress = $stateOf(Workflow::default(), 'In Progress');

    // connection 1: Mara switches WEB to the agency workflow, the transaction stays open
    RaceConnections::hold(fn () => $switch($mara, $web, $agency));

    // connection 2: Lene's move waits for the organization instead of moving the item in the old workflow
    $outcome = RaceConnections::second(fn () => TransitionWorkItem::run(actor($lene), $item, ['to_state_id' => $progress]));
    RaceConnections::expectLockWait($outcome, 'organization', null, 'lock in share mode');

    RaceConnections::release();

    expect($item->fresh()?->state_id)->toBe($stateOf($agency, 'Doing'));
});

it('moves in the new workflow once the switch is through', function () use ($world, $stateOf, $switch) {
    [$web, $item, $mara, $lene, $agency] = $world();
    $progress = $stateOf(Workflow::default(), 'In Progress');

    RaceConnections::hold(fn () => $switch($mara, $web, $agency));

    // the switch commits the moment Lene's move asks for the organization: under the lock it finds the item in the
    // new workflow, where the old state is unknown
    RaceConnections::releaseBeforeLock('organization', 'lock in share mode');
    $outcome = RaceConnections::second(fn () => TransitionWorkItem::run(actor($lene), $item, ['to_state_id' => $progress]));

    expect($outcome)->not->toBeInstanceOf(QueryException::class)->toBeInstanceOf(ValidationException::class);
    assert($outcome instanceof ValidationException);
    expect($outcome->errors())->toBe(['state_id' => [__('field.state_id.unknown')]])
        ->and($item->fresh()?->state_id)->toBe($stateOf($agency, 'Doing'));

    // a move within the new workflow goes through
    expect(RaceConnections::second(fn () => TransitionWorkItem::run(actor($lene), $item, ['to_state_id' => $stateOf($agency, 'Done')]))->state_id)
        ->toBe($stateOf($agency, 'Done'));
});

it('makes a move wait while a state of the workflow goes', function () use ($world, $stateOf, $withoutPending) {
    [, $item, $mara, $lene] = $world();
    [$input] = $withoutPending();

    RaceConnections::hold(fn () => SaveWorkflow::run(actor($mara), Workflow::default(), $input));

    $outcome = RaceConnections::second(fn () => TransitionWorkItem::run(actor($lene), $item, ['to_state_id' => $stateOf(Workflow::default(), 'Pending')]));
    RaceConnections::expectLockWait($outcome, 'organization', null, 'lock in share mode');

    RaceConnections::release();

    expect($item->fresh()?->state_id)->toBe($stateOf(Workflow::default(), 'Todo'));
});

it('a move into a state that is being removed fails cleanly', function () use ($world, $stateOf, $withoutPending) {
    [$web, $item, $mara, $lene] = $world();
    [$input, $pending] = $withoutPending();
    $todo = $stateOf(Workflow::default(), 'Todo');
    // another item stands in Pending: it moves to Todo with the removal
    $waiting = WorkItem::factory()->for($web)->inState('Pending')->create(['created_by' => $mara->id]);

    RaceConnections::hold(fn () => SaveWorkflow::run(actor($mara), Workflow::default(), [...$input, 'state_mapping' => [$pending => $todo]]));
    RaceConnections::releaseBeforeLock('organization', 'lock in share mode');

    $outcome = RaceConnections::second(fn () => TransitionWorkItem::run(actor($lene), $item, ['to_state_id' => $pending]));

    expect($outcome)->not->toBeInstanceOf(QueryException::class)->toBeInstanceOf(ValidationException::class);
    assert($outcome instanceof ValidationException);
    expect($outcome->errors())->toBe(['state_id' => [__('field.state_id.unknown')]])
        ->and($item->fresh()?->state_id)->toBe($todo)
        ->and($waiting->fresh()?->state_id)->toBe($todo)
        ->and(WorkflowState::query()->whereKey($pending)->exists())->toBeFalse();
});
