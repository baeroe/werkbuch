<?php

use App\Actions\AgentRuns\EnqueueRun;
use App\Events\EventType;
use App\Models\AgentConfig;
use App\Models\AgentProjectSettings;
use App\Models\Label;
use App\Models\Project;
use App\Models\User;
use App\Models\WorkItem;
use App\Support\Actor;
use Tests\Support\AgentWorld;

/*
 * The effort of Claude Code (WEBU-66): set at the bot (default and per kind), the project (per kind) and a label, chosen
 * when a run is queued like its model, kept at the run and sent with the claim; none at all leaves the CLI its own.
 */

$system = fn () => Actor::system(User::defaultBot(), 'test');

beforeEach(function () {
    $this->admin = User::factory()->admin()->create();
    $this->project = Project::factory()->identifier('WEB')->create();
    $this->agent = AgentWorld::agent([$this->project]);
});

it('saves the efforts of a bot, keeps them when left out and refuses a level the CLI does not take', function () {
    $this->actingAs($this->admin);
    $body = ['enabled' => true, 'runner_ids' => [], 'cli' => 'claude', 'model' => 'sonnet', 'models' => []];
    $path = "/api/v1/bots/{$this->agent->id}/agent";

    $this->putJson($path, [...$body, 'effort' => 'high', 'efforts' => ['review' => 'low']])->assertOk()
        ->assertJsonPath('data.effort', 'high')->assertJsonPath('data.efforts', ['review' => 'low']);
    expect(eventsOf(EventType::AgentConfigUpdated)->last()->changes)->toMatchArray(['effort' => ['old' => null, 'new' => 'high']]);
    $this->putJson($path, $body)->assertOk()->assertJsonPath('data.effort', 'high')->assertJsonPath('data.efforts', ['review' => 'low']);
    $this->putJson($path, [...$body, 'effort' => null, 'efforts' => []])->assertOk()->assertJsonPath('data.effort', null)->assertJsonPath('data.efforts', []);
    $this->putJson($path, [...$body, 'effort' => 'turbo', 'efforts' => ['task' => 'huge']])->assertUnprocessable()->assertJsonValidationErrors(['effort', 'efforts.task']);
    // Codex has no levels: one sent is refused, a saved one goes with the change of CLI
    $this->putJson($path, [...$body, 'effort' => 'max'])->assertOk();
    $this->putJson($path, [...$body, 'cli' => 'codex', 'model' => 'gpt-5-codex', 'effort' => 'max'])->assertUnprocessable()->assertJsonValidationErrors(['effort']);
    $this->putJson($path, [...$body, 'cli' => 'codex', 'model' => 'gpt-5-codex'])->assertOk()->assertJsonPath('data.effort', null);
});

it('saves the efforts of a project and the effort of a label', function () {
    $this->actingAs($this->admin);
    $settings = $this->getJson('/api/v1/projects/WEB/agents')->assertOk()->json('data');
    $send = array_intersect_key($settings, array_flip(['review_bot_id', 'instructions', 'models', 'max_corrections', 'max_conflicts', 'review_person_prs', 'comment_on_pr', 'merge_method', 'setup_command', 'stop_command', 'teardown_command']));

    $this->putJson('/api/v1/projects/WEB/agents', [...$send, 'efforts' => ['task' => 'xhigh']])->assertOk()->assertJsonPath('data.efforts', ['task' => 'xhigh']);
    $this->putJson('/api/v1/projects/WEB/agents', $send)->assertOk()->assertJsonPath('data.efforts', ['task' => 'xhigh']);
    $this->putJson('/api/v1/projects/WEB/agents', [...$send, 'efforts' => ['task' => 'nope']])->assertUnprocessable()->assertJsonValidationErrors(['efforts.task']);

    $label = $this->postJson('/api/v1/labels', ['name' => 'Knifflig', 'color' => 'moss', 'agent_effort' => 'max'])->assertCreated()->assertJsonPath('data.agent_effort', 'max')->json('data');
    $this->putJson("/api/v1/labels/{$label['id']}", ['name' => 'Knifflig', 'color' => 'moss'])->assertOk()->assertJsonPath('data.agent_effort', 'max');
    $this->putJson("/api/v1/labels/{$label['id']}", ['name' => 'Knifflig', 'color' => 'moss', 'agent_effort' => 'eleven'])->assertUnprocessable()->assertJsonValidationErrors(['agent_effort']);
    $this->putJson("/api/v1/labels/{$label['id']}", ['name' => 'Knifflig', 'color' => 'moss', 'agent_effort' => null])->assertOk()->assertJsonPath('data.agent_effort', null);
});

it('chooses the effort of a run when it is queued and sends it with the claim', function () use ($system) {
    AgentConfig::query()->where('bot_id', $this->agent->id)->update(['effort' => 'high', 'efforts' => json_encode(['review' => 'low'])]);
    $item = WorkItem::factory()->create(['project_id' => $this->project->id]);

    $run = EnqueueRun::run($system(), $this->agent, $this->project, $item, 'task', null);
    expect([$run->effort, $run->effort_source])->toBe(['high', 'default']);
    expect(EnqueueRun::run($system(), $this->agent, $this->project, $item, 'review', null)->effort)->toBe('low');

    AgentProjectSettings::query()->updateOrCreate(['project_id' => $this->project->id], [...AgentProjectSettings::DEFAULTS, 'efforts' => ['task' => 'medium']]);
    expect(EnqueueRun::run($system(), $this->agent, $this->project, $item, 'task', null)->effort_source)->toBe('project');

    $label = Label::factory()->create(['agent_effort' => 'max']);
    $item->labels()->attach($label->id);
    $labeled = EnqueueRun::run($system(), $this->agent, $this->project, $item, 'task', null);
    expect([$labeled->effort, $labeled->effort_source])->toBe(['max', 'label']);

    [, $token] = AgentWorld::runner();
    $this->postJson('/api/runner/claim', [], AgentWorld::headers($token))->assertOk()->assertJsonPath('run.type', 'review')->assertJsonPath('run.effort', 'low');
    $this->actingAs($this->admin)->getJson("/api/v1/runs/{$labeled->id}")->assertOk()->assertJsonPath('data.effort', 'max')->assertJsonPath('data.effort_source', 'label');

    // a Codex agent gets none
    AgentConfig::query()->where('bot_id', $this->agent->id)->update(['cli' => 'codex', 'model' => 'gpt-5-codex']);
    expect(EnqueueRun::run($system(), $this->agent, $this->project, $item, 'task', null)->effort)->toBeNull();
});
