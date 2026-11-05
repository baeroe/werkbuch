<?php

use App\Access\ProjectRole;
use App\Actions\Automations\FollowWorkflow;
use App\Actions\Projects\AssignWorkflow;
use App\Actions\Workflows\SaveWorkflow;
use App\Actions\WorkItems\RemapStates;
use App\Domain\Automations\AutomationKey;
use App\Domain\Workflow\StateCategory;
use App\Domain\Workflow\StateIcon;
use App\Events\EventType;
use App\Models\Automation;
use App\Models\Event;
use App\Models\Project;
use App\Models\User;
use App\Models\Workflow;
use Tests\Support\WorkflowFixtures;

/*
 * Auto-Close moves items into a Canceled state of the workflow of its project (spec 4.13). When the project gets
 * another workflow or its workflow loses that state (or the state stops being canceled, K11), the automation follows:
 * to the state the mapping names when that one is canceled, else to the first Canceled state of the workflow, else it
 * switches off.
 */

/** WEB (the default workflow) with Mara as its admin. */
$world = function (): array {
    $mara = User::factory()->admin()->create(['name' => 'Mara']);
    $web = Project::factory()->identifier('WEB')->member($mara, ProjectRole::Admin)->create();

    return [$web, $mara];
};

/** A free workflow with Backlog, Doing, Done and, at the end, these Canceled states. */
$workflowWith = function (string ...$canceled): Workflow {
    $workflow = Workflow::factory()->create();

    foreach ($canceled as $offset => $name) {
        $workflow->states()->create(['name' => $name, 'icon' => StateIcon::Cross, 'category' => StateCategory::Canceled, 'position' => 3 + $offset]);
    }

    return $workflow->load('states');
};

$stateOf = fn (Workflow $workflow, string $name): string => (string) $workflow->states()->where('name', $name)->value('id');

/** Auto-Close of the project, switched on and into its state of that name. */
$autoClose = function (Project $project, string $name, bool $enabled = true): Automation {
    $state = (string) $project->workflow()->firstOrFail()->states()->where('name', $name)->value('id');

    return Automation::factory()->for($project)->key(AutomationKey::AutoClose)->create(['enabled' => $enabled, 'settings' => ['days' => 60, 'state_id' => $state]]);
};

it('takes the canceled state the mapping of a new workflow names', function () use ($world, $workflowWith, $stateOf, $autoClose) {
    [$web, $mara] = $world();
    $automation = $autoClose($web, 'Cancelled');
    $old = $automation->settings['state_id'];
    $next = $workflowWith('Abgelehnt', 'Verworfen');

    AssignWorkflow::run(actor($mara), $web, ['workflow_id' => $next->id, 'mapping' => [$old => $stateOf($next, 'Verworfen')]]);
    $event = eventsOf(EventType::AutomationUpdated, $automation)->sole();

    expect($automation->fresh()?->only(['enabled', 'settings']))->toBe(['enabled' => true, 'settings' => ['days' => 60, 'state_id' => $stateOf($next, 'Verworfen')]])
        ->and($event->actor_id)->toBe($mara->id)
        ->and($event->project_id)->toBe($web->id)
        ->and($event->changes)->toBe(['state_id' => ['old' => $old, 'new' => $stateOf($next, 'Verworfen')]])
        ->and($event->meta['reason'] ?? null)->toBe(RemapStates::WORKFLOW_CHANGED)
        // the automation follows before the project records its new workflow
        ->and(Event::query()->whereIn('type', [EventType::AutomationUpdated, EventType::ProjectUpdated])->orderBy('occurred_at')->orderBy('id')->pluck('type')->map(fn (EventType $t) => $t->value)->all())
        ->toBe(['automation.updated', 'project.updated']);
});

it('takes the first Canceled state when the mapping names a Completed one or nothing', function () use ($world, $workflowWith, $stateOf, $autoClose) {
    [$web, $mara] = $world();
    $automation = $autoClose($web, 'Cancelled');
    $next = $workflowWith('Abgelehnt', 'Verworfen');

    AssignWorkflow::run(actor($mara), $web, ['workflow_id' => $next->id, 'mapping' => [$automation->settings['state_id'] => $stateOf($next, 'Done')]]);

    expect($automation->fresh()?->settings['state_id'])->toBe($stateOf($next, 'Abgelehnt'));

    // and back without a mapping: the first Canceled state of the default workflow
    AssignWorkflow::run(actor($mara), $web->fresh(), ['workflow_id' => Workflow::default()->id, 'mapping' => []]);

    expect($automation->fresh()?->settings['state_id'])->toBe($stateOf(Workflow::default(), 'Cancelled'))
        ->and(eventsOf(EventType::AutomationUpdated, $automation))->toHaveCount(2);
});

it('switches Auto-Close off when the new workflow has no Canceled state', function () use ($world, $autoClose) {
    [$web, $mara] = $world();
    $automation = $autoClose($web, 'Cancelled');
    $old = $automation->settings['state_id'];

    AssignWorkflow::run(actor($mara), $web, ['workflow_id' => Workflow::factory()->create()->id, 'mapping' => []]);

    expect($automation->fresh()?->only(['enabled', 'settings']))->toBe(['enabled' => false, 'settings' => ['days' => 60, 'state_id' => null]])
        ->and(eventsOf(EventType::AutomationUpdated, $automation)->sole()->changes)->toBe([
            'enabled' => ['old' => true, 'new' => false],
            'state_id' => ['old' => $old, 'new' => null],
        ]);
});

it('leaves a project without a state for Auto-Close, and the other automations, alone', function () use ($world, $workflowWith) {
    [$web, $mara] = $world();
    Automation::factory()->for($web)->key(AutomationKey::AutoArchive)->enabled()->create();
    $off = Automation::factory()->for($web)->key(AutomationKey::AutoClose)->create();

    AssignWorkflow::run(actor($mara), $web, ['workflow_id' => $workflowWith('Abgelehnt')->id, 'mapping' => []]);

    expect(eventsOf(EventType::AutomationUpdated))->toHaveCount(0)
        ->and($off->fresh()?->settings)->toBe(['days' => 90, 'state_id' => null]);
});

it('follows when SaveWorkflow removes the state, to the state that takes it over, with the reason', function () use ($world, $workflowWith, $stateOf, $autoClose) {
    [$web, $mara] = $world();
    $workflow = $workflowWith('Abgelehnt', 'Verworfen');
    $web->update(['workflow_id' => $workflow->id]);
    $automation = $autoClose($web, 'Abgelehnt');
    $off = $autoClose(Project::factory()->identifier('APP')->create(['workflow_id' => $workflow->id]), 'Abgelehnt', false);
    $deleting = $autoClose(Project::factory()->identifier('OLD')->create(['workflow_id' => $workflow->id]), 'Abgelehnt');
    $deleting->project->update(['deleting_at' => now()]);
    $other = $autoClose(Project::factory()->identifier('OPS')->create(), 'Cancelled');
    $old = $automation->settings['state_id'];

    $input = WorkflowFixtures::inputOf($workflow);
    $input['states'] = [
        ...array_values(array_filter($input['states'], fn (array $state) => $state['name'] !== 'Abgelehnt')),
        ['id' => 'st_storniert', 'name' => 'Storniert', 'icon' => 'cross', 'category' => 'canceled'],
    ];
    $input['state_mapping'] = [$old => 'st_storniert'];
    SaveWorkflow::run(actor($mara), $workflow, $input);
    $storniert = $stateOf($workflow, 'Storniert');

    expect($automation->fresh()?->only(['enabled', 'settings']))->toBe(['enabled' => true, 'settings' => ['days' => 60, 'state_id' => $storniert]])
        ->and(eventsOf(EventType::AutomationUpdated, $automation)->sole()->meta['reason'] ?? null)->toBe(RemapStates::STATE_REMOVED)
        ->and(eventsOf(EventType::AutomationUpdated, $automation)->sole()->actor_id)->toBe($mara->id)
        // an automation that is off follows as well and stays off
        ->and($off->fresh()?->only(['enabled', 'settings']))->toBe(['enabled' => false, 'settings' => ['days' => 60, 'state_id' => $storniert]])
        // a project being deleted and a project of another workflow are left alone
        ->and($deleting->fresh()?->settings['state_id'])->toBe($old)
        ->and(eventsOf(EventType::AutomationUpdated, $deleting))->toHaveCount(0)
        ->and(eventsOf(EventType::AutomationUpdated, $other))->toHaveCount(0)
        ->and(eventsOf(EventType::AutomationUpdated))->toHaveCount(2);

    // without a mapping: the first Canceled state that is left
    $input = WorkflowFixtures::inputOf($workflow->fresh());
    $input['states'] = array_values(array_filter($input['states'], fn (array $state) => $state['name'] !== 'Storniert'));
    SaveWorkflow::run(actor($mara), $workflow->fresh(), $input);

    expect($automation->fresh()?->settings['state_id'])->toBe($stateOf($workflow, 'Verworfen'));
});

it('follows when SaveWorkflow makes the state of Auto-Close something other than canceled (K11)', function () use ($world, $workflowWith, $stateOf, $autoClose) {
    [$web, $mara] = $world();
    $workflow = $workflowWith('Abgelehnt', 'Verworfen');
    $web->update(['workflow_id' => $workflow->id]);
    $automation = $autoClose($web, 'Abgelehnt');

    // only the name of the state changes: nothing to follow
    $input = WorkflowFixtures::inputOf($workflow);
    $input['states'] = array_map(fn (array $state) => $state['name'] === 'Abgelehnt' ? [...$state, 'name' => 'Nein'] : $state, $input['states']);
    SaveWorkflow::run(actor($mara), $workflow, $input);

    expect(eventsOf(EventType::AutomationUpdated))->toHaveCount(0);

    $input['states'] = array_map(fn (array $state) => $state['name'] === 'Nein' ? [...$state, 'category' => 'completed'] : $state, $input['states']);
    SaveWorkflow::run(actor($mara), $workflow->fresh(), $input);

    expect($automation->fresh()?->settings['state_id'])->toBe($stateOf($workflow, 'Verworfen'))
        ->and(eventsOf(EventType::AutomationUpdated, $automation)->sole()->meta['reason'] ?? null)->toBe(RemapStates::STATE_REMOVED);
});

it('changes nothing when the state of Auto-Close is a Canceled state of the workflow', function () use ($world, $autoClose) {
    [$web, $mara] = $world();
    $automation = $autoClose($web, 'Cancelled');

    FollowWorkflow::run(actor($mara), $web, [], Workflow::default(), RemapStates::WORKFLOW_CHANGED);

    expect($automation->fresh()?->settings['state_id'])->toBe($automation->settings['state_id'])
        ->and(eventsOf(EventType::AutomationUpdated))->toHaveCount(0);
});
