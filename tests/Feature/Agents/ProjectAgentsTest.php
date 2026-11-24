<?php

use App\Access\ProjectRole;
use App\Domain\Agents\AgentModel;
use App\Events\EventType;
use App\Models\AgentProjectSettings;
use App\Models\Project;
use App\Models\User;
use App\Models\Workflow;
use Tests\Support\AgentWorld;

/*
 * The agent settings of a project (spec 10.3): the defaults without a row, a whole `PUT` by its admins, the review agent
 * an agent of the project, the models of the list of the CLIs.
 */

$body = fn (array $changes = []) => [
    'review_bot_id' => null, 'instructions' => null, 'models' => [], 'max_corrections' => 3, 'max_conflicts' => 2,
    'review_person_prs' => true, 'comment_on_pr' => true, 'merge_method' => 'squash', 'setup_command' => null, 'teardown_command' => null, ...$changes,
];

it('reads the defaults of a project without settings and whether its workflow names the steps of the agents', function () {
    $project = Project::factory()->create(['identifier' => 'WEB']);

    $this->actingAs(User::factory()->admin()->create())->getJson('/api/v1/projects/WEB/agents')->assertOk()
        ->assertJsonPath('data.max_corrections', 3)->assertJsonPath('data.merge_method', 'squash')->assertJsonPath('data.steps_complete', false)
        ->assertJsonPath('data.updated_at', null);

    $states = Workflow::default()->states->pluck('id', 'name');
    Workflow::default()->forceFill(['agent_states' => ['working' => $states['In Progress'], 'review' => $states['Pending'], 'correction' => $states['Todo'], 'merged' => $states['Done']]])->save();
    $this->getJson("/api/v1/projects/{$project->id}/agents")->assertJsonPath('data.steps_complete', true);
});

it('sets the settings as a whole once and only what changed makes an event', function () use ($body) {
    $project = Project::factory()->create(['identifier' => 'WEB']);
    $reviewer = AgentWorld::agent([$project], [], 'Rita');
    $admin = User::factory()->admin()->create();

    $this->actingAs($admin)->putJson('/api/v1/projects/WEB/agents', $body([
        'review_bot_id' => strtoupper($reviewer->id), 'instructions' => 'Run `pest` in DDEV.', 'models' => ['review' => 'claude:opus', 'comment' => 'claude:haiku'],
        'max_corrections' => 5, 'merge_method' => 'rebase', 'setup_command' => 'ddev start', 'comment_on_pr' => false,
    ]))->assertOk()->assertJsonPath('data.review_bot_id', $reviewer->id)->assertJsonPath('data.models.comment', 'claude:haiku');

    $answer = $this->getJson('/api/v1/projects/WEB/agents')->json('data');
    $this->putJson('/api/v1/projects/WEB/agents', $answer)->assertOk();

    expect(AgentProjectSettings::query()->sole()->only(['max_corrections', 'merge_method', 'setup_command', 'comment_on_pr']))
        ->toBe(['max_corrections' => 5, 'merge_method' => 'rebase', 'setup_command' => 'ddev start', 'comment_on_pr' => false])
        ->and(eventsOf(EventType::ProjectAgentSettingsUpdated, $project))->toHaveCount(1)
        ->and(array_keys(eventsOf(EventType::ProjectAgentSettingsUpdated, $project)->sole()->changes))->toBe(['review_bot_id', 'instructions', 'models', 'max_corrections', 'comment_on_pr', 'merge_method', 'setup_command']);
});

it('refuses a reviewer that cannot work in the project, a model of no list and every missing key', function () use ($body) {
    $project = Project::factory()->create(['identifier' => 'WEB']);
    $outside = AgentWorld::agent([], [], 'Otto');
    $this->actingAs(User::factory()->admin()->create());

    $this->putJson('/api/v1/projects/WEB/agents', $body(['review_bot_id' => $outside->id]))->assertUnprocessable()->assertJsonPath('errors.review_bot_id.0', __('field.review_bot_id.invalid'));
    $this->putJson('/api/v1/projects/WEB/agents', $body(['review_bot_id' => 'nope', 'models' => ['task' => 'claude:gpt-5', 'nope' => 'x'], 'max_conflicts' => 0, 'merge_method' => 'cherry']))
        ->assertUnprocessable()->assertJsonValidationErrors(['review_bot_id', 'models', 'max_conflicts', 'merge_method']);
    $this->putJson('/api/v1/projects/WEB/agents', $body(['models' => ['task' => 'claude:gpt-5']]))->assertJsonPath('errors', ['models.task' => [__('field.models.agent_model', ['allowed' => implode(', ', AgentModel::values())])]]);
    $this->putJson('/api/v1/projects/WEB/agents', [])->assertUnprocessable()->assertJsonPath('errors.instructions.0', __('field.required'));

    // only the admins of the project
    $this->actingAs(memberOf($project, ProjectRole::Member))->putJson('/api/v1/projects/WEB/agents', $body())->assertForbidden();
});
