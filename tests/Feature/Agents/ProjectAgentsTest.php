<?php

use App\Access\OrgRole;
use App\Access\ProjectRole;
use App\Access\RoleAssignments;
use App\Access\Visibility;
use App\Domain\Agents\AgentModel;
use App\Events\EventType;
use App\Models\AgentProjectSettings;
use App\Models\Project;
use App\Models\User;
use App\Models\Workflow;
use App\Support\ProjectAgentBots;
use Illuminate\Support\Facades\DB;
use Tests\Support\AgentWorld;

/*
 * The agent settings of a project (spec 10.3): the defaults without a row, a whole `PUT` by its admins, the review agent
 * an agent of the project, the models of the list of the CLIs.
 */

$body = fn (array $changes = []) => [
    'review_bot_id' => null, 'instructions' => null, 'models' => [], 'max_corrections' => 3, 'max_conflicts' => 2,
    'review_person_prs' => true, 'comment_on_pr' => true, 'merge_method' => 'squash', 'setup_command' => null, 'stop_command' => null, 'teardown_command' => null, ...$changes,
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

it('names the bots that could review in the project with their agent and models (A621)', function () use ($body) {
    $project = Project::factory()->create(['identifier' => 'WEB']);
    $rita = AgentWorld::agent([$project], ['enabled' => true, 'cli' => 'claude', 'model' => 'sonnet', 'models' => ['review' => 'opus']], 'Rita');
    $off = AgentWorld::agent([$project], ['enabled' => false], 'Bert');
    $viewer = AgentWorld::agent([], [], 'Vera');
    app(RoleAssignments::class)->setProjectRole($viewer, $project, ProjectRole::Viewer);
    $outside = AgentWorld::agent([], [], 'Otto');
    $gone = AgentWorld::agent([$project], [], 'Gina');
    $gone->forceFill(['disabled_at' => now()])->save();
    $plain = User::factory()->bot(User::factory()->create())->create(['name' => 'Paul']);
    app(RoleAssignments::class)->setProjectRole($plain, $project, ProjectRole::Member);
    $person = User::factory()->create();
    app(RoleAssignments::class)->setProjectRole($person, $project, ProjectRole::Member);

    $bots = $this->actingAs(User::factory()->admin()->create())->getJson('/api/v1/projects/WEB/agents')->assertOk()->json('data.bots');

    expect(array_column($bots, 'bot_id'))->toBe([$off->id, $plain->id, $rita->id, $viewer->id])
        ->and($bots[2])->toBe(['bot_id' => $rita->id, 'enabled' => true, 'member' => true, 'reviews' => true, 'cli' => 'claude', 'model' => 'sonnet', 'models' => ['review' => 'opus']])
        ->and($bots[1])->toMatchArray(['enabled' => false, 'reviews' => true, 'model' => 'sonnet', 'models' => []])
        ->and($bots[3]['reviews'])->toBeFalse();

    // the saved reviewer stays in the list after it left the project, so the choice still shows it
    $this->putJson('/api/v1/projects/WEB/agents', $body(['review_bot_id' => $rita->id]))->assertOk();
    app(RoleAssignments::class)->removeFromProject($rita, $project);
    Visibility::forget();
    $bots = $this->getJson('/api/v1/projects/WEB/agents')->json('data.bots');
    expect(array_column($bots, 'bot_id'))->toContain($rita->id)
        ->and(collect($bots)->firstWhere('bot_id', $rita->id)['reviews'])->toBeFalse()
        ->and(array_column($bots, 'bot_id'))->not->toContain($outside->id);
});

it('lets a project admin who is no org admin read the bots of the project', function () {
    $project = Project::factory()->create(['identifier' => 'WEB']);
    $rita = AgentWorld::agent([$project], ['enabled' => true], 'Rita');
    $admin = User::factory()->create();
    app(RoleAssignments::class)->setProjectRole($admin, $project, ProjectRole::Admin);

    expect($this->actingAs($admin)->getJson('/api/v1/projects/WEB/agents')->assertOk()->json('data.bots'))
        ->toHaveCount(1)->and($this->getJson('/api/v1/projects/WEB/agents')->json('data.bots.0'))->toMatchArray(['bot_id' => $rita->id, 'enabled' => true, 'reviews' => true]);
});

it('offers an org admin bot as review agent without a membership, and as a viewer member too', function () use ($body) {
    $project = Project::factory()->create(['identifier' => 'WEB']);
    $boss = AgentWorld::agent([], ['enabled' => true], 'Boss');
    app(RoleAssignments::class)->setOrgRole($boss, OrgRole::Admin);
    $viewer = AgentWorld::agent([], ['enabled' => true], 'Vic');
    app(RoleAssignments::class)->setOrgRole($viewer, OrgRole::Admin);
    app(RoleAssignments::class)->setProjectRole($viewer, $project, ProjectRole::Viewer);
    Visibility::forget();

    $bots = $this->actingAs(User::factory()->admin()->create())->getJson('/api/v1/projects/WEB/agents')->assertOk()->json('data.bots');

    expect(array_column($bots, 'bot_id'))->toContain($boss->id, $viewer->id)
        ->and(collect($bots)->firstWhere('bot_id', $boss->id)['reviews'])->toBeTrue()
        ->and(collect($bots)->firstWhere('bot_id', $boss->id)['member'])->toBeFalse()
        ->and(collect($bots)->firstWhere('bot_id', $viewer->id)['member'])->toBeTrue()
        ->and(collect($bots)->firstWhere('bot_id', $viewer->id)['reviews'])->toBeTrue();
    // as the backend allows it
    $this->putJson('/api/v1/projects/WEB/agents', $body(['review_bot_id' => $boss->id]))->assertOk();
});

it('reads the roles of all bots at once, however many there are', function () {
    $count = function (int $bots) {
        $project = Project::factory()->create();
        foreach (range(1, $bots) as $n) {
            AgentWorld::agent([$project], [], "Bot {$n}");
        }
        Visibility::forget();
        $queries = 0;
        DB::listen(function () use (&$queries) {
            $queries++;
        });
        ProjectAgentBots::of($project, null);

        return $queries;
    };

    expect($count(1))->toBe($count(5));
});

it('reads the saved review agent only when it changes', function () use ($body) {
    $project = Project::factory()->create(['identifier' => 'WEB']);
    $rita = AgentWorld::agent([$project], [], 'Rita');
    $this->actingAs(User::factory()->admin()->create())->putJson('/api/v1/projects/WEB/agents', $body(['review_bot_id' => $rita->id]))->assertOk();

    $read = [];
    DB::listen(function ($query) use (&$read, $rita) {
        if (str_contains($query->sql, 'from `users` where `users`.`id` = ?') && in_array($rita->id, $query->bindings, true)) {
            $read[] = $query->sql;
        }
    });
    $this->putJson('/api/v1/projects/WEB/agents', $body(['review_bot_id' => $rita->id, 'max_corrections' => 4]))->assertOk();

    expect($read)->toBe([]);
});
