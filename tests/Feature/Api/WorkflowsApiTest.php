<?php

use App\Actions\Workflows\DeleteWorkflow;
use App\Actions\Workflows\SaveWorkflow;
use App\Events\EventType;
use App\Models\Project;
use App\Models\User;
use App\Models\Workflow;
use App\Models\WorkflowState;
use App\Models\WorkflowTransition;
use Illuminate\Support\Str;
use Tests\Support\WorkflowFixtures;

/** The shape of `Workflow` in resources/js/types.ts. */
const WORKFLOW_SHAPE = ['id', 'name', 'description', 'is_default', 'is_free', 'initial_state_id', 'states', 'transitions'];

/** The input with every value `$from` replaced by `$to` (state ids in states, start state and transitions). */
$replaceId = function (array $input, string $from, string $to): array {
    array_walk_recursive($input, function (mixed &$value) use ($from, $to) {
        if ($value === $from) {
            $value = $to;
        }
    });

    return $input;
};

it('lists the workflows with their states in order and their transitions', function () {
    // created Doing → Done first: the answer orders the pairs by the position of their states
    $matrix = Workflow::factory()->matrix([[1, 2], [0, 1]])->create(['name' => 'Matrix']);
    $ids = $matrix->states()->pluck('id')->all();

    $response = $this->actingAs(User::factory()->create())->getJson('/api/v1/workflows')->assertOk()
        ->assertJsonStructure(['data' => ['*' => WORKFLOW_SHAPE], 'meta' => ['total']])
        ->assertJsonPath('meta.total', 2)
        ->assertJsonPath('data.0.name', 'Standard')->assertJsonPath('data.0.is_default', true)->assertJsonPath('data.0.is_free', true)
        ->assertJsonPath('data.0.transitions', [])
        ->assertJsonPath('data.1.name', 'Matrix')->assertJsonPath('data.1.is_free', false)
        ->assertJsonPath('data.1.transitions', [[$ids[0], $ids[1]], [$ids[1], $ids[2]]]);

    expect(array_column($response->json('data.0.states'), 'name'))->toBe(['Backlog', 'Todo', 'In Progress', 'Pending', 'Done', 'Cancelled'])
        ->and(array_column($response->json('data.0.states'), 'position'))->toBe([0, 1, 2, 3, 4, 5])
        ->and($response->json('data.0.states.0'))->toBe([
            'id' => Workflow::default()->initial_state_id, 'name' => 'Backlog', 'icon' => 'dashed', 'category' => 'backlog', 'position' => 0,
        ]);
});

it('creates a workflow with a matrix, giving the new states ids of their own', function () {
    $admin = User::factory()->admin()->create();
    $input = WorkflowFixtures::agencyInput();

    $response = $this->actingAs($admin)->postJson('/api/v1/workflows', $input)->assertCreated()
        ->assertJsonStructure(['data' => WORKFLOW_SHAPE])
        ->assertJsonPath('data.name', 'Agentur-Freigabe')->assertJsonPath('data.is_default', false)->assertJsonPath('data.is_free', false);

    $states = $response->json('data.states');
    // local id → ULID, by the order the states were sent in
    $ulidOf = array_combine(array_column($input['states'], 'id'), array_column($states, 'id'));
    $expected = array_map(fn (array $pair) => [$ulidOf[$pair[0]], $ulidOf[$pair[1]]], $input['transitions']);
    $position = array_flip(array_column($states, 'id'));
    usort($expected, fn (array $a, array $b) => [$position[$a[0]], $position[$a[1]]] <=> [$position[$b[0]], $position[$b[1]]]);

    $workflow = Workflow::query()->findOrFail($response->json('data.id'));

    expect(Str::isUlid($response->json('data.id')))->toBeTrue()
        ->and(array_filter(array_column($states, 'id'), fn (string $id) => ! Str::isUlid($id)))->toBe([])
        ->and(array_column($states, 'name'))->toBe(array_column($input['states'], 'name'))
        ->and($response->json('data.initial_state_id'))->toBe($ulidOf['app_backlog'])
        ->and($response->json('data.transitions'))->toHaveCount(14)->toBe($expected)
        ->and(eventsOf(EventType::WorkflowCreated, $workflow)->sole()->changes)->toBe(['name' => ['old' => null, 'new' => 'Agentur-Freigabe']])
        ->and(eventsOf(EventType::WorkflowUpdated))->toBeEmpty();
});

it('refuses Agentur-Freigabe without the transition into Review and saves nothing', function () {
    $input = WorkflowFixtures::agencyInput();
    $input['transitions'] = array_values(array_filter($input['transitions'], fn (array $pair) => $pair[1] !== 'app_review'));

    $response = $this->actingAs(User::factory()->admin()->create())->postJson('/api/v1/workflows', $input)->assertUnprocessable()
        ->assertJsonPath('reason', 'invalid_workflow')->assertJsonPath('detail', __('problem.detail.invalid_workflow'))
        ->assertJsonPath('issues', [
            ['code' => 'unreachable_state', 'state_id' => 'app_review'],
            ['code' => 'unreachable_state', 'state_id' => 'app_approval'],
            ['code' => 'unreachable_state', 'state_id' => 'app_done'],
        ]);

    expect($response->json('errors.unreachable_state'))->toBe([
        __('field.workflow.unreachable_state', ['name' => 'Review']),
        __('field.workflow.unreachable_state', ['name' => 'Kundenfreigabe']),
        __('field.workflow.unreachable_state', ['name' => 'Done']),
    ])
        ->and(Workflow::query()->count())->toBe(1)
        ->and(WorkflowState::query()->count())->toBe(6)
        ->and(eventsOf(EventType::WorkflowCreated)->filter(fn ($event) => $event->actor_id !== User::defaultBot()->id))->toBeEmpty();
});

it('refuses a workflow without a completed status or without its start among the states', function (Closure $change, string $code, string $message) {
    $response = $this->actingAs(User::factory()->admin()->create())
        ->postJson('/api/v1/workflows', $change(WorkflowFixtures::agencyInput()))->assertUnprocessable()
        ->assertJsonPath('reason', 'invalid_workflow')->assertJsonPath("errors.{$code}", [__($message)])->assertJsonPath('issues', [['code' => $code]]);

    expect(Workflow::query()->count())->toBe(1);
})->with([
    'no completed status' => [function (array $input) {
        $input['states'][5]['category'] = 'canceled';

        return $input;
    }, 'no_completed_state', 'field.workflow.no_completed_state'],
    'a start that is no state of it' => [fn (array $input) => [...$input, 'initial_state_id' => 'app_elsewhere'], 'no_initial_state', 'field.workflow.no_initial_state'],
]);

it('checks names, icons, categories and the number of states', function (Closure $change, string $field, string $message) {
    $response = $this->actingAs(User::factory()->admin()->create())
        ->postJson('/api/v1/workflows', $change(WorkflowFixtures::agencyInput('Neu')))->assertUnprocessable()
        ->assertJsonPath('reason', 'validation_failed');

    expect(errorsAt($response, $field))->toBe([$message])
        ->and(Workflow::query()->count())->toBe(1);
})->with([
    'an empty name' => [fn (array $input) => [...$input, 'name' => ''], 'name', fn () => __('field.name.required')],
    'a name of 61 characters' => [fn (array $input) => [...$input, 'name' => str_repeat('n', 61)], 'name', fn () => __('field.name.max', ['max' => 60])],
    'a name that exists in other capitals' => [fn (array $input) => [...$input, 'name' => 'STANDARD'], 'name', fn () => __('field.name.taken')],
    'a name that exists with other accents' => [fn (array $input) => [...$input, 'name' => 'Ståndard'], 'name', fn () => __('field.name.taken')],
    'a status without a name' => [function (array $input) {
        $input['states'][1]['name'] = ' ';

        return $input;
    }, 'states.1.name', fn () => __('field.states.name_required')],
    'a status name of 41 characters' => [function (array $input) {
        $input['states'][1]['name'] = str_repeat('s', 41);

        return $input;
    }, 'states.1.name', fn () => __('field.states.name_max', ['max' => 40])],
    'an unknown icon' => [function (array $input) {
        $input['states'][1]['icon'] = 'square';

        return $input;
    }, 'states.1.icon', fn () => __('field.states.icon')],
    'an unknown category' => [function (array $input) {
        $input['states'][1]['category'] = 'done';

        return $input;
    }, 'states.1.category', fn () => __('field.states.category')],
    '31 states' => [fn (array $input) => [...$input, 'states' => array_map(
        fn (int $n) => ['id' => "st_{$n}", 'name' => "Status {$n}", 'icon' => 'check', 'category' => 'completed'],
        range(1, 31),
    ), 'initial_state_id' => 'st_1', 'transitions' => []], 'states', fn () => __('field.states.max', ['max' => 30])],
    'no states' => [fn (array $input) => [...$input, 'states' => [], 'transitions' => []], 'states', fn () => __('field.states.required')],
    'two states with one id' => [function (array $input) {
        $input['states'][1]['id'] = 'app_backlog';

        return $input;
    }, 'states.1.id', fn () => __('field.states.duplicate_id')],
    'an id that looks like the key of a state without one' => [function (array $input) {
        $input['states'][0]['id'] = 'new:1';
        unset($input['states'][1]['id']);

        return $input;
    }, 'states.0.id', fn () => __('field.states.id_reserved')],
    'an id of 65 characters' => [function (array $input) {
        $input['states'][1]['id'] = str_repeat('i', 65);

        return $input;
    }, 'states.1.id', fn () => __('field.states.id_invalid', ['max' => 64])],
    'a transition of one status' => [fn (array $input) => [...$input, 'transitions' => [['app_backlog'], ...$input['transitions']]], 'transitions.0', fn () => __('field.transitions.invalid')],
    'transitions that are no list' => [fn (array $input) => [...$input, 'transitions' => 'all'], 'transitions', fn () => __('field.transitions.invalid')],
    'a default mark that is no boolean' => [fn (array $input) => [...$input, 'is_default' => 'ja'], 'is_default', fn () => __('field.boolean')],
    'a start that is no text' => [fn (array $input) => [...$input, 'initial_state_id' => 7], 'initial_state_id', fn () => __('field.workflow.no_initial_state')],
    'a mapping that is no list' => [fn (array $input) => [...$input, 'state_mapping' => 'all'], 'state_mapping', fn () => __('field.state_mapping.invalid')],
]);

it('keeps the ids of the states it is sent back, renames and reorders them', function () {
    $admin = User::factory()->admin()->create();
    $workflow = SaveWorkflow::run(actor($admin), null, WorkflowFixtures::agencyInput());
    $input = WorkflowFixtures::inputOf($workflow);
    $old = array_map(fn (array $state) => array_diff_key($state, ['position' => true]), $input['states']);
    [$backlog, $todo, $progress, $review, $approval, $done, $cancelled] = array_column($input['states'], 'id');

    // Todo moves behind In Progress, Review gets another name, a new state QA without an id comes behind it
    $qaInput = ['name' => 'QA', 'icon' => 'circle', 'category' => 'started'];
    $input['states'] = [$input['states'][0], $input['states'][2], $input['states'][1], $input['states'][3], $qaInput, ...array_slice($input['states'], 4)];
    $input['states'][3]['name'] = 'Interne Prüfung';
    // Cancelled can no longer be reopened
    $input['transitions'] = array_values(array_filter($input['transitions'], fn (array $pair) => $pair !== [$cancelled, $backlog]));
    $input['transitions'][] = [$review, 'new:4'];
    $input['transitions'][] = ['new:4', $approval];

    $this->travel(5)->minutes();
    $response = $this->actingAs($admin)->putJson("/api/v1/workflows/{$workflow->id}", $input)->assertOk();
    $states = $response->json('data.states');
    $qa = $states[4]['id'];

    expect(array_column($states, 'id'))->toBe([$backlog, $progress, $todo, $review, $qa, $approval, $done, $cancelled])
        ->and(array_column($states, 'name'))->toBe(['Backlog', 'In Progress', 'Todo', 'Interne Prüfung', 'QA', 'Kundenfreigabe', 'Done', 'Cancelled'])
        ->and(array_column($states, 'position'))->toBe(range(0, 7))
        ->and($states[3]['name'])->toBe('Interne Prüfung')
        ->and(Str::isUlid($qa))->toBeTrue()
        ->and($response->json('data.transitions'))->toContain([$review, $qa], [$qa, $approval])->not->toContain([$cancelled, $backlog])
        ->and(WorkflowTransition::query()->where('workflow_id', $workflow->id)->count())->toBe(15)
        ->and(WorkflowState::query()->where('workflow_id', $workflow->id)->count())->toBe(8)
        // only states and transitions changed, the workflow changed all the same
        ->and($workflow->fresh()?->updated_at?->gte($workflow->updated_at?->copy()->addMinutes(5)))->toBeTrue();

    $changes = eventsOf(EventType::WorkflowUpdated, $workflow)->sole()->changes;

    expect(array_keys($changes))->toBe(['states', 'transitions'])
        ->and($changes['states']['old'])->toBe($old)
        ->and(array_column($changes['states']['new'], 'id'))->toBe([$backlog, $progress, $todo, $review, $qa, $approval, $done, $cancelled])
        ->and($changes['states']['new'][3])->toBe(['id' => $review, 'name' => 'Interne Prüfung', 'icon' => 'three-quarter', 'category' => 'started'])
        ->and($changes['transitions']['old'])->toHaveCount(14)
        ->and($changes['transitions']['new'])->toHaveCount(15);
});

it('drops transitions that lead nowhere or to the same status, and pairs sent twice', function () {
    $input = WorkflowFixtures::agencyInput();
    $input['transitions'] = [...$input['transitions'], ['app_backlog', 'app_nowhere'], ['app_todo', 'app_todo'], ['app_backlog', 'app_todo']];

    $response = $this->actingAs(User::factory()->admin()->create())->postJson('/api/v1/workflows', $input)->assertCreated();

    expect($response->json('data.transitions'))->toHaveCount(14)
        ->and(WorkflowTransition::query()->where('workflow_id', $response->json('data.id'))->count())->toBe(14);
});

it('takes a state id of another workflow as a new state', function () use ($replaceId) {
    $standard = Workflow::default();
    $foreign = $standard->initial_state_id;
    $before = WorkflowState::query()->where('workflow_id', $standard->id)->orderBy('position')->get()->toArray();

    $response = $this->actingAs(User::factory()->admin()->create())
        ->postJson('/api/v1/workflows', $replaceId(WorkflowFixtures::agencyInput(), 'app_backlog', strtoupper((string) $foreign)))
        ->assertCreated();
    $backlog = $response->json('data.states.0.id');

    expect($backlog)->not->toBe($foreign)
        ->and(Str::isUlid($backlog))->toBeTrue()
        ->and($response->json('data.initial_state_id'))->toBe($backlog)
        ->and($response->json('data.transitions'))->toContain([$backlog, $response->json('data.states.1.id')])
        ->and(WorkflowState::query()->where('workflow_id', $standard->id)->orderBy('position')->get()->toArray())->toBe($before);
});

it('finds the ids of its states also in capitals', function () {
    $admin = User::factory()->admin()->create();
    $workflow = SaveWorkflow::run(actor($admin), null, WorkflowFixtures::agencyInput());
    $input = WorkflowFixtures::inputOf($workflow);
    $ids = array_column($input['states'], 'id');

    $input['states'] = array_map(fn (array $state) => [...$state, 'id' => strtoupper($state['id'])], $input['states']);
    $input['initial_state_id'] = strtoupper($input['initial_state_id']);
    $input['transitions'] = array_map(fn (array $pair) => array_map(strtoupper(...), $pair), $input['transitions']);

    $response = $this->actingAs($admin)->putJson("/api/v1/workflows/{$workflow->id}", $input)->assertOk();

    expect(array_column($response->json('data.states'), 'id'))->toBe($ids)
        ->and(WorkflowState::query()->where('workflow_id', $workflow->id)->count())->toBe(7)
        ->and(eventsOf(EventType::WorkflowUpdated, $workflow))->toBeEmpty();
});

it('records nothing when nothing changes', function () {
    $admin = User::factory()->admin()->create();
    $answer = $this->actingAs($admin)->postJson('/api/v1/workflows', WorkflowFixtures::agencyInput())->assertCreated()->json('data');
    $workflow = Workflow::query()->findOrFail($answer['id']);
    $this->travel(5)->minutes();

    $this->putJson("/api/v1/workflows/{$workflow->id}", $answer)->assertOk()->assertJsonPath('data', $answer);

    expect(eventsOf(EventType::WorkflowUpdated))->toBeEmpty()
        ->and($workflow->fresh()?->updated_at?->toJSON())->toBe($workflow->updated_at?->toJSON())
        // a write now would stamp the time five minutes on
        ->and(WorkflowState::query()->where('workflow_id', $workflow->id)->where('updated_at', '>', now()->subMinute())->exists())->toBeFalse()
        ->and(WorkflowTransition::query()->where('workflow_id', $workflow->id)->where('updated_at', '>', now()->subMinute())->exists())->toBeFalse();
});

it('makes one workflow the default and takes the mark from the other', function () {
    $admin = User::factory()->admin()->create();
    $standard = Workflow::default();
    $agency = SaveWorkflow::run(actor($admin), null, WorkflowFixtures::agencyInput());

    $this->actingAs($admin)->putJson("/api/v1/workflows/{$agency->id}", [...WorkflowFixtures::inputOf($agency), 'is_default' => true])
        ->assertOk()->assertJsonPath('data.is_default', true);

    expect(Workflow::query()->where('is_default', true)->pluck('id')->all())->toBe([$agency->id])
        ->and(eventsOf(EventType::WorkflowUpdated))->toHaveCount(2)
        ->and(eventsOf(EventType::WorkflowUpdated, $standard)->sole()->changes)->toBe(['is_default' => ['old' => true, 'new' => false]])
        ->and(eventsOf(EventType::WorkflowUpdated, $agency)->sole()->changes)->toBe(['is_default' => ['old' => false, 'new' => true]]);
});

it('refuses to leave the organization without a default workflow', function () {
    $standard = Workflow::default();

    $this->actingAs(User::factory()->admin()->create())
        ->putJson("/api/v1/workflows/{$standard->id}", [...WorkflowFixtures::inputOf($standard), 'is_default' => false])
        ->assertUnprocessable()->assertJsonPath('errors.is_default', [__('field.is_default.required')]);

    expect(Workflow::default()->is($standard))->toBeTrue()
        ->and(eventsOf(EventType::WorkflowUpdated))->toBeEmpty();
});

it('checks a state mapping against the states that go and the ones that stay', function () {
    $this->actingAs(User::factory()->admin()->create());
    $standard = Workflow::default();
    $input = WorkflowFixtures::inputOf($standard);
    [, $todo, $progress, $pending] = array_column($input['states'], 'id');
    // Pending goes
    $input['states'] = array_values(array_filter($input['states'], fn (array $state) => $state['id'] !== $pending));

    $staying = $this->putJson("/api/v1/workflows/{$standard->id}", [...$input, 'state_mapping' => [$todo => $progress]])->assertUnprocessable();
    $gone = $this->putJson("/api/v1/workflows/{$standard->id}", [...$input, 'state_mapping' => [$pending => $pending]])->assertUnprocessable();

    expect(errorsAt($staying, "state_mapping.{$todo}"))->toBe([__('field.mapping.unknown_state')])
        ->and(errorsAt($gone, "state_mapping.{$pending}"))->toBe([__('field.mapping.target')])
        ->and(WorkflowState::query()->whereKey($pending)->exists())->toBeTrue();

    $this->putJson("/api/v1/workflows/{$standard->id}", [...$input, 'state_mapping' => [$pending => $progress]])->assertOk();

    expect(WorkflowState::query()->whereKey($pending)->exists())->toBeFalse()
        ->and(array_column(eventsOf(EventType::WorkflowUpdated, $standard)->sole()->changes['states']['new'], 'name'))
        ->toBe(['Backlog', 'Todo', 'In Progress', 'Done', 'Cancelled']);
});

it('deletes an unused workflow with its states and transitions', function () {
    $workflow = Workflow::factory()->matrix([[0, 1], [1, 2]])->create(['name' => 'Alt']);

    $this->actingAs(User::factory()->admin()->create())->deleteJson("/api/v1/workflows/{$workflow->id}")->assertNoContent();

    expect(Workflow::query()->whereKey($workflow->id)->exists())->toBeFalse()
        ->and(WorkflowState::query()->where('workflow_id', $workflow->id)->exists())->toBeFalse()
        ->and(WorkflowTransition::query()->where('workflow_id', $workflow->id)->exists())->toBeFalse()
        ->and(eventsOf(EventType::WorkflowDeleted, $workflow)->sole()->meta['name'])->toBe('Alt');
});

it('never deletes the default workflow', function () {
    $this->actingAs(User::factory()->admin()->create())->deleteJson('/api/v1/workflows/'.Workflow::default()->id)
        ->assertConflict()->assertJsonPath('reason', 'default_workflow')->assertJsonPath('detail', __('problem.detail.default_workflow'));

    expect(Workflow::query()->count())->toBe(1)
        ->and(eventsOf(EventType::WorkflowDeleted))->toBeEmpty();
});

it('refuses to delete a workflow a project uses, naming the projects', function () {
    $workflow = Workflow::factory()->create();
    // by name, not by identifier: Auftritt, Betrieb, Zentrale
    Project::factory()->identifier('WEB')->create(['name' => 'Auftritt', 'workflow_id' => $workflow->id]);
    // archived projects and projects being deleted still hold their workflow
    Project::factory()->identifier('OPS')->archived()->create(['name' => 'Betrieb', 'workflow_id' => $workflow->id]);
    Project::factory()->identifier('APP')->create(['name' => 'Zentrale', 'workflow_id' => $workflow->id, 'deleting_at' => now()]);
    Project::factory()->identifier('DOC')->create(['name' => 'Doku']);

    $this->actingAs(User::factory()->admin()->create())->deleteJson("/api/v1/workflows/{$workflow->id}")
        ->assertConflict()->assertJsonPath('reason', 'in_use')->assertJsonPath('projects', ['WEB', 'OPS', 'APP'])
        // nobody sees a project being deleted any more: the sentence says why it still counts
        ->assertJsonPath('detail', __('problem.detail.workflow_in_use', ['projects' => 'WEB, OPS, APP (being deleted)']));

    expect(Workflow::query()->whereKey($workflow->id)->exists())->toBeTrue()
        ->and(eventsOf(EventType::WorkflowDeleted))->toBeEmpty();
});

it('lets every account read the workflows and only org admins change them', function () {
    $workflow = Workflow::factory()->create();
    $denied = __('problem.detail.workflows_admins_only');

    $this->actingAs(User::factory()->create());

    $this->getJson('/api/v1/workflows')->assertOk()->assertJsonPath('meta.total', 2);
    $this->postJson('/api/v1/workflows', WorkflowFixtures::agencyInput())->assertForbidden()->assertJsonPath('detail', $denied);
    $this->putJson("/api/v1/workflows/{$workflow->id}", WorkflowFixtures::inputOf($workflow))->assertForbidden()->assertJsonPath('detail', $denied);
    $this->deleteJson("/api/v1/workflows/{$workflow->id}")->assertForbidden()->assertJsonPath('detail', $denied);

    expect(Workflow::query()->count())->toBe(2);
});

it('answers an unknown workflow with 404 and no detail', function (string $id) {
    $this->actingAs(User::factory()->admin()->create());

    $this->putJson("/api/v1/workflows/{$id}", WorkflowFixtures::agencyInput())->assertNotFound()->assertJsonMissingPath('detail');
    $this->deleteJson("/api/v1/workflows/{$id}")->assertNotFound()->assertJsonMissingPath('detail');
})->with([
    'an unknown ULID' => [fn () => (string) Str::ulid()],
    'no ULID' => ['standard'],
]);

it('replaces a workflow as a whole', function () {
    $admin = User::factory()->admin()->create();
    $standard = Workflow::default();
    $description = $standard->description;
    $this->actingAs($admin);

    foreach (['is_default', 'is_free', 'initial_state_id', 'states', 'transitions'] as $field) {
        $input = WorkflowFixtures::inputOf($standard);
        unset($input[$field]);

        expect(errorsAt($this->putJson("/api/v1/workflows/{$standard->id}", $input)->assertUnprocessable(), $field))
            ->toBe([__('field.required')], "without {$field}");
    }

    $input = WorkflowFixtures::inputOf($standard);
    unset($input['description']);

    $this->putJson("/api/v1/workflows/{$standard->id}", $input)->assertOk()->assertJsonPath('data.description', '');

    expect($standard->fresh()?->description)->toBe('')
        ->and(eventsOf(EventType::WorkflowUpdated, $standard)->sole()->changes)->toBe([
            'description' => ['old' => $description, 'new' => ''],
        ]);
});

it('answers 404 for a workflow deleted meanwhile', function () {
    $admin = User::factory()->admin()->create();
    $workflow = Workflow::factory()->create();
    $input = [...WorkflowFixtures::inputOf($workflow), 'name' => 'Neu'];
    $workflow->delete();

    expect(problemOf(fn () => SaveWorkflow::run(actor($admin), $workflow, $input))->status)->toBe(404)
        ->and(problemOf(fn () => DeleteWorkflow::run(actor($admin), $workflow))->status)->toBe(404)
        ->and(WorkflowState::query()->where('workflow_id', $workflow->id)->exists())->toBeFalse()
        ->and(eventsOf(EventType::WorkflowUpdated))->toBeEmpty()
        ->and(eventsOf(EventType::WorkflowDeleted))->toBeEmpty();
});
