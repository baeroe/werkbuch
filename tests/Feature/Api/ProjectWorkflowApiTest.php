<?php

use App\Access\ProjectRole;
use App\Access\Visibility;
use App\Actions\Projects\AssignWorkflow;
use App\Actions\Projects\CreateProject;
use App\Events\EventType;
use App\Exceptions\Problem;
use App\Models\Event;
use App\Models\Project;
use App\Models\User;
use App\Models\Workflow;

/*
 * PUT /api/v1/projects/{project}/workflow: the one way to switch the workflow of a project (P9). Phase 3 has no items,
 * so the mapping of the states is checked for its form only (P5).
 */

it('switches the workflow of a project and records it', function () {
    $admin = User::factory()->create();
    $web = CreateProject::run(actor($admin), ['name' => 'Website', 'identifier' => 'WEB']);
    $standard = Workflow::default();
    $agency = Workflow::factory()->create(['name' => 'Agentur-Freigabe']);

    $this->actingAs($admin)->putJson('/api/v1/projects/WEB/workflow', ['workflow_id' => strtoupper($agency->id), 'mapping' => []])
        ->assertOk()->assertJsonPath('data.workflow_id', $agency->id)->assertJsonPath('data.identifier', 'WEB');

    $event = eventsOf(EventType::ProjectUpdated, $web)->sole();

    expect($web->fresh()?->workflow_id)->toBe($agency->id)
        ->and($event->actor_id)->toBe($admin->id)
        ->and($event->project_id)->toBe($web->id)
        ->and($event->changes)->toBe(['workflow_id' => ['old' => $standard->id, 'new' => $agency->id]]);
});

it('records nothing when the workflow stays', function () {
    $admin = User::factory()->create();
    $web = CreateProject::run(actor($admin), ['name' => 'Website', 'identifier' => 'WEB']);

    // without a mapping, and with one onto its own states
    $this->actingAs($admin)->putJson('/api/v1/projects/WEB/workflow', ['workflow_id' => $web->workflow_id])
        ->assertOk()->assertJsonPath('data.workflow_id', $web->workflow_id);
    $state = Workflow::default()->states[0]->id;
    $this->putJson('/api/v1/projects/WEB/workflow', ['workflow_id' => $web->workflow_id, 'mapping' => [$state => $state]])->assertOk();

    expect(eventsOf(EventType::ProjectUpdated, $web))->toBeEmpty();
});

it('checks the mapping against the old and the new states', function () {
    $admin = User::factory()->create();
    $web = CreateProject::run(actor($admin), ['name' => 'Website', 'identifier' => 'WEB']);
    $agency = Workflow::factory()->create(['name' => 'Agentur-Freigabe']);
    $old = Workflow::default()->states[1]->id;
    $new = $agency->states[0]->id;

    $notOld = $this->actingAs($admin)->putJson('/api/v1/projects/WEB/workflow', ['workflow_id' => $agency->id, 'mapping' => [$new => $new]])
        ->assertUnprocessable();
    $notNew = $this->putJson('/api/v1/projects/WEB/workflow', ['workflow_id' => $agency->id, 'mapping' => [strtoupper($old) => $old]])
        ->assertUnprocessable();
    $this->putJson('/api/v1/projects/WEB/workflow', ['workflow_id' => $agency->id, 'mapping' => 'all'])
        ->assertUnprocessable()->assertJsonPath('errors.mapping', [__('field.state_mapping.invalid')]);

    expect(errorsAt($notOld, "mapping.{$new}"))->toBe([__('field.mapping.unknown_state')])
        ->and(errorsAt($notNew, "mapping.{$old}"))->toBe([__('field.mapping.target')])
        ->and($web->fresh()?->workflow_id)->toBe(Workflow::default()->id);

    // the keys in any case, the targets as well
    $this->putJson('/api/v1/projects/WEB/workflow', ['workflow_id' => $agency->id, 'mapping' => [strtoupper($old) => strtoupper($new)]])->assertOk();
});

it('refuses an unknown workflow', function (mixed $workflow, string $message) {
    $admin = User::factory()->create();
    CreateProject::run(actor($admin), ['name' => 'Website', 'identifier' => 'WEB']);

    $this->actingAs($admin)->putJson('/api/v1/projects/WEB/workflow', ['workflow_id' => $workflow, 'mapping' => []])
        ->assertUnprocessable()->assertJsonPath('errors.workflow_id', [__($message)]);
})->with([
    'unknown' => ['01jbxxxxxxxxxxxxxxxxxxxxxx', 'field.workflow_id.unknown'],
    'no text' => [['x'], 'field.workflow_id.unknown'],
    'missing' => [null, 'field.required'],
]);

it('hides a private project from outsiders and refuses members', function () {
    $ops = Project::factory()->identifier('OPS')->private()->create();
    $member = memberOf($ops, ProjectRole::Member);
    $agency = Workflow::factory()->create(['name' => 'Agentur-Freigabe']);
    $body = ['workflow_id' => $agency->id, 'mapping' => []];

    $this->actingAs(User::factory()->create())->putJson('/api/v1/projects/OPS/workflow', $body)
        ->assertNotFound()->assertJsonMissingPath('detail');
    $this->actingAs($member)->putJson('/api/v1/projects/OPS/workflow', $body)
        ->assertForbidden()->assertJsonPath('detail', __('problem.detail.project_workflow_admins'));

    expect($ops->fresh()?->workflow_id)->toBe(Workflow::default()->id);
});

it('answers 404 for a project that is being deleted', function () {
    $admin = User::factory()->admin()->create();
    $web = CreateProject::run(actor($admin), ['name' => 'Website', 'identifier' => 'WEB']);
    $agency = Workflow::factory()->create(['name' => 'Agentur-Freigabe']);
    // read before the deletion began, rights and all, as by a request that runs at the same time
    $stale = Project::query()->findOrFail($web->id);
    expect(Visibility::projectIds($admin)->all())->toContain($web->id);
    $web->update(['deleting_at' => now()]);

    expect(fn () => AssignWorkflow::run(actor($admin), $stale, ['workflow_id' => $agency->id, 'mapping' => []]))
        ->toThrow(fn (Problem $problem) => expect($problem->status)->toBe(404))
        ->and($web->fresh()?->workflow_id)->toBe(Workflow::default()->id)
        ->and(Event::query()->where('type', EventType::ProjectUpdated)->count())->toBe(0);
});
