<?php

use App\Access\ProjectRole;
use App\Actions\WorkItems\GetWorkItem;
use App\Domain\Agents\RunStatus;
use App\Http\Resources\WorkItemResource;
use App\Models\AgentProjectSettings;
use App\Models\AgentThread;
use App\Models\Project;
use App\Models\User;
use App\Models\Workflow;
use App\Models\WorkItem;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Tests\Support\AgentWorld;
use Tests\Support\FakeGitHub;
use Tests\Support\Mcp\McpClient;

/*
 * What the agents do at an item (`include=agent`, WEBU-28, A640): the strand, why the bot of the item is no agent,
 * the brakes, the repo and the guard; for whoever sees the item.
 */

beforeEach(function () {
    $this->mara = User::factory()->create(['name' => 'Mara']);
    $this->project = Project::factory()->identifier('WEB')->public()->member($this->mara, ProjectRole::Member)->create();
    $this->kira = AgentWorld::agent([$this->project]);
});

/** The `agent` of an item as the resource answers it for Mara. */
$agent = function (WorkItem $item): array {
    $found = GetWorkItem::run(actor(test()->mara), $item->id, ['agent']);

    return (new WorkItemResource($found))->resolve(Request::create('/'))['agent'];
};

it('says nothing of agents at an item of a person', function () use ($agent) {
    $item = WorkItem::factory()->for($this->project)->create(['assignee_id' => $this->mara->id]);

    expect($agent($item))->toBe([
        'thread' => null,
        'runs' => 0,
        'refusal' => null,
        'ready_state' => null,
        'blocked_by' => [],
        'brakes' => ['max_corrections' => 3, 'max_conflicts' => 2],
        'repository' => false,
        'guard' => null,
    ]);
    expect($agent(WorkItem::factory()->for($this->project)->create())['refusal'])->toBeNull();
});

it('says why the bot of the item is no agent here, never more', function () use ($agent) {
    $plain = User::factory()->bot($this->mara)->create();
    $item = WorkItem::factory()->for($this->project)->create(['assignee_id' => $plain->id]);

    expect($agent($item)['refusal'])->toBe('agent_off')
        // the default workflow names no step of the agents
        ->and($agent(WorkItem::factory()->for($this->project)->create(['assignee_id' => $this->kira->id]))['refusal'])->toBe('no_steps');

    $workflow = Workflow::default();
    $states = $workflow->states->pluck('id', 'name');
    $workflow->forceFill(['agent_states' => [
        'working' => $states['In Progress'], 'review' => $states['Pending'], 'correction' => $states['Todo'], 'merged' => $states['Done'],
    ]])->save();

    expect($agent(WorkItem::factory()->for($this->project)->create(['assignee_id' => $this->kira->id]))['refusal'])->toBeNull()
        // an agent that is no member of the project may not edit its items
        ->and($agent(WorkItem::factory()->for($this->project)->create(['assignee_id' => AgentWorld::agent()->id]))['refusal'])->toBe('not_member');
});

it('names the open or paused strand of the item with its counters', function () use ($agent) {
    $item = WorkItem::factory()->for($this->project)->create(['assignee_id' => $this->kira->id]);
    AgentThread::factory()->create(['bot_id' => $this->kira->id, 'work_item_id' => $item->id, 'status' => AgentThread::MERGED]);
    expect($agent($item)['thread'])->toBeNull();

    [$runner] = AgentWorld::runner();
    $thread = AgentThread::factory()->create([
        'bot_id' => $this->kira->id, 'work_item_id' => $item->id, 'status' => AgentThread::PAUSED, 'pause_reason' => 'brake',
        'corrections' => 3, 'conflicts' => 1, 'pr_number' => 24, 'branch' => 'agent/WEB-1-form', 'runner_id' => $runner->id,
    ]);

    expect($agent($item)['thread'])->toBe([
        'id' => $thread->id, 'bot_id' => $this->kira->id, 'status' => 'paused', 'pause_reason' => 'brake',
        'corrections' => 3, 'conflicts' => 1, 'pr_number' => 24, 'branch' => 'agent/WEB-1-form', 'runner_id' => $runner->id,
    ]);
});

it('names the brakes, the repo and the guard of the project', function () use ($agent) {
    FakeGitHub::connected();
    $link = FakeGitHub::link($this->project);
    AgentProjectSettings::factory()->create(['project_id' => $this->project->id, 'max_corrections' => 5, 'max_conflicts' => 1]);
    $item = WorkItem::factory()->for($this->project)->create(['assignee_id' => $this->kira->id]);
    $other = WorkItem::factory()->for($this->project)->create();

    expect($agent($item))->toMatchArray(['brakes' => ['max_corrections' => 5, 'max_conflicts' => 1], 'repository' => true, 'guard' => null]);

    $link->forceFill(['guard_detected_at' => now(), 'guard_sha' => str_repeat('a', 40), 'guard_branch' => 'main', 'guard_runs' => [
        ['run_id' => '01kbbbbbbbbbbbbbbbbbbbbbbb', 'item_id' => $item->id, 'bot_id' => $this->kira->id],
        ['run_id' => '01kccccccccccccccccccccccc', 'item_id' => null, 'bot_id' => $this->kira->id],
    ]])->save();

    expect($agent($item)['guard'])->toBe(['branch' => 'main', 'sha' => str_repeat('a', 40), 'here' => true])
        ->and($agent($other)['guard'])->toBe(['branch' => 'main', 'sha' => str_repeat('a', 40), 'here' => false]);

    $link->forceFill(['guard_runs' => null])->save();
    expect($agent($item)['guard']['here'])->toBeFalse();
});

it('reads the agent state with as many queries for a strand with runs as for none', function () {
    $count = function (WorkItem $item): int {
        $fresh = WorkItem::query()->findOrFail($item->id);
        DB::enableQueryLog();
        DB::flushQueryLog();
        GetWorkItem::run(actor($this->mara), $fresh, ['agent']);
        $count = count(DB::getQueryLog());
        DB::disableQueryLog();

        return $count;
    };
    $quiet = WorkItem::factory()->for($this->project)->create(['assignee_id' => $this->kira->id]);
    $busy = WorkItem::factory()->for($this->project)->create(['assignee_id' => $this->kira->id]);
    $thread = AgentThread::factory()->create(['bot_id' => $this->kira->id, 'work_item_id' => $busy->id]);
    foreach (range(1, 5) as $n) {
        AgentWorld::run($this->kira, $busy, attributes: ['thread_id' => $thread->id, 'status' => RunStatus::Succeeded]);
    }

    // once each first: the roles and the visibility of the request are read then
    $count($quiet);
    $count($busy);
    expect($count($busy))->toBe($count($quiet));
});

it('counts the runs of the item, whatever their status and strand', function () use ($agent) {
    $item = WorkItem::factory()->for($this->project)->create(['assignee_id' => $this->kira->id]);
    $other = WorkItem::factory()->for($this->project)->create();
    $thread = AgentThread::factory()->create(['bot_id' => $this->kira->id, 'work_item_id' => $item->id, 'status' => AgentThread::MERGED]);
    AgentWorld::run($this->kira, $item, attributes: ['thread_id' => $thread->id, 'status' => RunStatus::Succeeded]);
    AgentWorld::run($this->kira, $item, attributes: ['status' => RunStatus::Failed]);
    AgentWorld::run($this->kira, $item);
    AgentWorld::run($this->kira, $other);

    expect($agent($item)['runs'])->toBe(3)
        ->and($agent($other)['runs'])->toBe(1)
        ->and($agent(WorkItem::factory()->for($this->project)->create())['runs'])->toBe(0);
});

it('answers the agent state over REST and MCP', function () {
    $item = WorkItem::factory()->for($this->project)->create(['assignee_id' => $this->kira->id]);
    AgentThread::factory()->create(['bot_id' => $this->kira->id, 'work_item_id' => $item->id, 'status' => AgentThread::PAUSED, 'pause_reason' => 'github']);

    $this->actingAs($this->mara)->getJson("/api/v1/work-items/{$item->key}?include=agent")->assertOk()
        ->assertJsonPath('data.agent.thread.pause_reason', 'github')
        ->assertJsonPath('data.agent.refusal', 'no_steps');

    $answer = McpClient::for($this, apiToken($this->mara, ['read', 'mcp']))->call('work-items', ['action' => 'get', 'item' => $item->key, 'include' => ['agent']]);
    expect($answer['structuredContent']['data']['agent']['thread']['status'])->toBe('paused');
});
