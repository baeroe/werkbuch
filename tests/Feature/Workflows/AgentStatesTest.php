<?php

use App\Actions\Workflows\SaveWorkflow;
use App\Events\EventType;
use App\Exceptions\Problem;
use App\Models\Project;
use App\Models\User;
use App\Models\Workflow;
use App\Models\WorkItem;
use Illuminate\Validation\ValidationException;
use Tests\Support\WorkflowFixtures;

/*
 * The steps of the agents on a workflow (spec 7.4, WEBU-25): the state each step sets, checked by category, kept when
 * the input leaves them out, following `state_mapping` when their state goes.
 */

$steps = fn (string $working, string $review, string $correction, string $merged) => compact('working', 'review', 'correction', 'merged');

$errorsOf = function (Closure $save): array {
    try {
        $save();
    } catch (ValidationException $e) {
        return $e->errors();
    } catch (Problem $e) {
        return $e->errors;
    }

    throw new RuntimeException('Saved.');
};

it('saves the steps with the states of the input and answers them as ULIDs', function () use ($steps) {
    $admin = User::factory()->admin()->create();
    $input = [...WorkflowFixtures::standardInput('Agenten'), 'agent_states' => $steps('std_progress', 'std_pending', 'std_todo', 'std_done')];

    $response = $this->actingAs($admin)->postJson('/api/v1/workflows', $input)->assertCreated();
    $ids = array_column($response->json('data.states'), 'id', 'name');

    expect($response->json('data.agent_states'))->toBe($steps($ids['In Progress'], $ids['Pending'], $ids['Todo'], $ids['Done']))
        ->and(Workflow::query()->findOrFail($response->json('data.id'))->agentStepsComplete())->toBeTrue();
});

it('answers no steps for a workflow without them and lets a step stay empty', function () {
    $admin = User::factory()->admin()->create();
    $this->actingAs($admin)->getJson('/api/v1/workflows/'.Workflow::default()->id)->assertOk()
        ->assertJsonPath('data.agent_states', ['working' => null, 'review' => null, 'correction' => null, 'merged' => null]);

    $input = [...WorkflowFixtures::standardInput('Halb'), 'agent_states' => ['working' => 'std_progress', 'review' => null]];
    $response = $this->actingAs($admin)->postJson('/api/v1/workflows', $input)->assertCreated();

    expect($response->json('data.agent_states.review'))->toBeNull()
        ->and($response->json('data.agent_states.merged'))->toBeNull()
        ->and(Workflow::query()->findOrFail($response->json('data.id'))->agentStepsComplete())->toBeFalse();
});

it('refuses a step on a state of the wrong category, an unknown state and an unknown step', function () use ($steps, $errorsOf) {
    $actor = actor(User::factory()->admin()->create());
    $input = [...WorkflowFixtures::standardInput('Falsch'), 'agent_states' => [...$steps('std_todo', 'nope', 'std_progress', 'std_cancelled'), 'deploy' => 'std_done']];

    $errors = $errorsOf(fn () => SaveWorkflow::run($actor, null, $input));

    expect($errors)->toBe([
        'agent_states.deploy' => [__('field.agent_states.step')],
        'agent_states.working' => [__('field.agent_states.category', ['step' => __('catalog.agent_step.working'), 'categories' => __('catalog.category.started')])],
        'agent_states.review' => [__('field.agent_states.unknown')],
        'agent_states.correction' => [__('field.agent_states.category', ['step' => __('catalog.agent_step.correction'), 'categories' => __('catalog.category.backlog').' / '.__('catalog.category.unstarted')])],
        'agent_states.merged' => [__('field.agent_states.category', ['step' => __('catalog.agent_step.merged'), 'categories' => __('catalog.category.completed')])],
    ])->and(Workflow::query()->where('name', 'Falsch')->exists())->toBeFalse();

    expect($errorsOf(fn () => SaveWorkflow::run($actor, null, [...WorkflowFixtures::standardInput('Liste'), 'agent_states' => 'std_done'])))
        ->toBe(['agent_states' => [__('field.agent_states.invalid')]])
        ->and($errorsOf(fn () => SaveWorkflow::run($actor, null, [...WorkflowFixtures::standardInput('Zahl'), 'agent_states' => ['merged' => 5]])))
        ->toBe(['agent_states.merged' => [__('field.agent_states.unknown')]]);
});

it('keeps the steps when the input leaves them out, also through its own answer sent back', function () use ($steps) {
    $actor = actor(User::factory()->admin()->create());
    $workflow = SaveWorkflow::run($actor, null, [...WorkflowFixtures::standardInput('Bleibt'), 'agent_states' => $steps('std_progress', 'std_pending', 'std_todo', 'std_done')]);
    $stored = $workflow->agentStates();

    $input = WorkflowFixtures::inputOf($workflow);
    unset($input['agent_states']);
    $input['name'] = 'Bleibt noch';
    $saved = SaveWorkflow::run($actor, $workflow, $input);

    expect($saved->agentStates())->toBe($stored)
        ->and(eventsOf(EventType::WorkflowUpdated, $workflow)->sole()->changes)->toBe(['name' => ['old' => 'Bleibt', 'new' => 'Bleibt noch']]);

    SaveWorkflow::run($actor, $saved, WorkflowFixtures::inputOf($saved));
    expect(eventsOf(EventType::WorkflowUpdated, $workflow))->toHaveCount(1);
});

it('records a change of the steps and clears one sent as null', function () use ($steps) {
    $actor = actor(User::factory()->admin()->create());
    $workflow = SaveWorkflow::run($actor, null, [...WorkflowFixtures::standardInput('Wechsel'), 'agent_states' => $steps('std_progress', 'std_pending', 'std_todo', 'std_done')]);
    $before = $workflow->agentStates();
    $ids = $workflow->states->pluck('id', 'name');

    $saved = SaveWorkflow::run($actor, $workflow, [...WorkflowFixtures::inputOf($workflow), 'agent_states' => ['working' => $ids['Pending'], 'review' => $ids['In Progress'], 'correction' => $ids['Backlog']]]);
    $after = ['working' => $ids['Pending'], 'review' => $ids['In Progress'], 'correction' => $ids['Backlog'], 'merged' => null];

    expect($saved->agentStates())->toBe($after)
        ->and(eventsOf(EventType::WorkflowUpdated, $workflow)->sole()->changes)->toBe(['agent_states' => ['old' => $before, 'new' => $after]]);
});

it('lets a removed state take its step along the state mapping, or clears it when the target does not fit', function () use ($steps) {
    $actor = actor(User::factory()->admin()->create());
    $workflow = SaveWorkflow::run($actor, null, [...WorkflowFixtures::standardInput('Weg'), 'agent_states' => $steps('std_progress', 'std_pending', 'std_todo', 'std_done')]);
    $ids = $workflow->states->pluck('id', 'name');
    $input = WorkflowFixtures::inputOf($workflow);
    unset($input['agent_states']);
    // Pending goes to a new state „In Review“ (started), Todo goes to Backlog (fits), Done stays
    $input['states'] = array_values(array_filter($input['states'], fn (array $state) => ! in_array($state['name'], ['Pending', 'Todo'], true)));
    $input['states'][] = ['id' => 'new_review', 'name' => 'In Review', 'icon' => 'three-quarter', 'category' => 'started'];
    $input['state_mapping'] = [$ids['Pending'] => 'new_review', $ids['Todo'] => $ids['Backlog']];

    $saved = SaveWorkflow::run($actor, $workflow, $input);
    $review = $saved->states->firstWhere('name', 'In Review')->id;

    expect($saved->agentStates())->toBe(['working' => $ids['In Progress'], 'review' => $review, 'correction' => $ids['Backlog'], 'merged' => $ids['Done']]);

    // In Progress goes to Done: the target is no started state, the step is cleared
    $input = WorkflowFixtures::inputOf($saved);
    unset($input['agent_states']);
    $input['states'] = array_values(array_filter($input['states'], fn (array $state) => $state['name'] !== 'In Progress'));
    $input['state_mapping'] = [$ids['In Progress'] => $ids['Done']];
    $again = SaveWorkflow::run($actor, $saved, $input);

    expect($again->agentStates()['working'])->toBeNull()->and($again->agentStepsComplete())->toBeFalse();

    // a state that goes without a mapping (no items) clears its step too
    $input = WorkflowFixtures::inputOf($again);
    unset($input['agent_states']);
    $input['states'] = array_values(array_filter($input['states'], fn (array $state) => $state['name'] !== 'Backlog'));
    $input['initial_state_id'] = $input['states'][0]['id'];

    expect(SaveWorkflow::run($actor, $again, $input)->agentStates()['correction'])->toBeNull();
});

it('refuses to change the category of a state a kept step names, at the state', function () use ($steps, $errorsOf) {
    $actor = actor(User::factory()->admin()->create());
    $workflow = SaveWorkflow::run($actor, null, [...WorkflowFixtures::standardInput('Kategorie'), 'agent_states' => $steps('std_progress', 'std_pending', 'std_todo', 'std_done')]);
    $input = WorkflowFixtures::inputOf($workflow);
    unset($input['agent_states']);
    $index = array_search('Pending', array_column($input['states'], 'name'), true);
    $input['states'][$index]['category'] = 'unstarted';

    expect($errorsOf(fn () => SaveWorkflow::run($actor, $workflow, $input)))->toBe([
        "states.{$index}.category" => [__('field.states.agent_step', ['step' => __('catalog.agent_step.review'), 'categories' => __('catalog.category.started')])],
    ]);

    // sent along with steps that no longer name it, the change goes through
    $ids = $workflow->states->pluck('id', 'name');
    $input['agent_states'] = ['working' => $ids['In Progress'], 'review' => null, 'correction' => $ids['Pending'], 'merged' => $ids['Done']];

    expect(SaveWorkflow::run($actor, $workflow, $input)->agentStates()['correction'])->toBe($ids['Pending']);
});

it('never lets the steps of one workflow name a state of another', function () use ($errorsOf) {
    $actor = actor(User::factory()->admin()->create());
    $other = Workflow::default()->states->first()->id;
    $project = Project::factory()->create();
    WorkItem::factory()->for($project)->create();

    expect($errorsOf(fn () => SaveWorkflow::run($actor, null, [...WorkflowFixtures::standardInput('Fremd'), 'agent_states' => ['correction' => $other]])))
        ->toBe(['agent_states.correction' => [__('field.agent_states.unknown')]]);
});

it('wants two states for in progress and in review, sent or kept', function () use ($steps, $errorsOf) {
    $actor = actor(User::factory()->admin()->create());
    $same = [...WorkflowFixtures::standardInput('Gleich'), 'agent_states' => $steps('std_progress', 'std_progress', 'std_todo', 'std_done')];

    expect($errorsOf(fn () => SaveWorkflow::run($actor, null, $same)))->toBe(['agent_states.review' => [__('field.agent_states.same')]]);

    // both states go to the same one: the steps would be one
    $workflow = SaveWorkflow::run($actor, null, [...WorkflowFixtures::standardInput('Zusammen'), 'agent_states' => $steps('std_progress', 'std_pending', 'std_todo', 'std_done')]);
    $ids = $workflow->states->pluck('id', 'name');
    $input = WorkflowFixtures::inputOf($workflow);
    unset($input['agent_states']);
    $input['states'] = array_values(array_filter($input['states'], fn (array $state) => ! in_array($state['name'], ['In Progress', 'Pending'], true)));
    $input['states'][] = ['id' => 'new_doing', 'name' => 'Doing', 'icon' => 'half', 'category' => 'started'];
    $input['state_mapping'] = [$ids['In Progress'] => 'new_doing', $ids['Pending'] => 'new_doing'];

    expect($errorsOf(fn () => SaveWorkflow::run($actor, $workflow, $input)))->toBe(['agent_states.review' => [__('field.agent_states.same')]]);
});
