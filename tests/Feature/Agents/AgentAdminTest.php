<?php

use App\Actions\AgentRuns\EnqueueRun;
use App\Actions\AgentRuns\ReapLostRuns;
use App\Actions\AgentRuns\RetryRun;
use App\Domain\Agents\RunStatus;
use App\Events\EventType;
use App\Exceptions\Problem;
use App\Live\LiveConsumer;
use App\Models\AgentConfig;
use App\Models\AgentRun;
use App\Models\Project;
use App\Models\User;
use App\Models\WorkItem;
use App\Support\Actor;
use Illuminate\Support\Facades\DB;
use Tests\Support\AgentWorld;

/*
 * Runners and the agent configuration over REST (spec 10.1, 10.4, A484, A485), and the edges of queueing, retrying and
 * reaping runs.
 */

beforeEach(function () {
    $this->admin = User::factory()->admin()->create();
    $this->project = Project::factory()->create();
});

it('lists, shows, renames and revokes runners, and gives a revoked one\'s name free', function () {
    [$runner] = AgentWorld::runner(['name' => 'mac-mini']);
    [$other] = AgentWorld::runner(['name' => 'studio']);
    $agent = AgentWorld::agent([$this->project]);
    $running = AgentRun::factory()->running($runner)->create(['bot_id' => $agent->id, 'work_item_id' => WorkItem::factory()->create(['project_id' => $this->project->id])->id]);
    $this->actingAs($this->admin);

    $this->getJson('/api/v1/runners')->assertOk()->assertJsonPath('meta.total', 2)->assertJsonPath('data.0.name', 'mac-mini')
        ->assertJsonPath('data.0.slots_used', ['total' => 1, 'per_repo' => 1, 'light' => 0])
        ->assertJsonPath('data.0.online', true);
    $this->patchJson("/api/v1/runners/{$runner->id}", ['name' => ' STUDIO '])->assertUnprocessable()->assertJsonPath('errors.name.0', __('field.runner.name_taken'));
    $this->patchJson("/api/v1/runners/{$runner->id}", ['slots' => ['total' => 2, 'per_repo' => 3, 'light' => 0]])->assertUnprocessable()
        ->assertJsonValidationErrors(['slots.per_repo', 'slots.light']);
    $this->patchJson("/api/v1/runners/{$runner->id}", ['name' => '  Mac Mini  ', 'slots' => ['total' => 4, 'per_repo' => 2, 'light' => 3]])->assertOk()
        ->assertJsonPath('data.name', 'Mac Mini')->assertJsonPath('data.slots', ['total' => 4, 'per_repo' => 2, 'light' => 3]);
    expect(eventsOf(EventType::RunnerUpdated, $runner)->sole()->changes)->toBe([
        'name' => ['old' => 'mac-mini', 'new' => 'Mac Mini'],
        'slots' => ['old' => ['total' => 2, 'per_repo' => 1, 'light' => 2], 'new' => ['total' => 4, 'per_repo' => 2, 'light' => 3]],
    ]);
    $this->patchJson("/api/v1/runners/{$runner->id}", ['name' => 'Mac Mini'])->assertOk();
    expect(eventsOf(EventType::RunnerUpdated, $runner)->count())->toBe(1);

    $this->deleteJson("/api/v1/runners/{$other->id}")->assertOk()->assertExactJson(['canceled' => 0]);
    $this->deleteJson("/api/v1/runners/{$runner->id}")->assertOk()->assertExactJson(['canceled' => 1]);
    expect([$running->fresh()->status, $running->fresh()->error, $running->fresh()->canceled_by])->toBe([RunStatus::Canceled, 'runner_revoked', $this->admin->id]);
    $this->getJson("/api/v1/runners/{$runner->id}")->assertNotFound();
    $this->deleteJson("/api/v1/runners/{$runner->id}")->assertNotFound();
    $this->patchJson("/api/v1/runners/{$runner->id}", ['name' => 'x'])->assertNotFound();
    $this->getJson('/api/v1/runners')->assertOk()->assertJsonPath('meta.total', 0);

    // the name of a revoked runner is free again
    [$third] = AgentWorld::runner();
    $this->patchJson("/api/v1/runners/{$third->id}", ['name' => 'studio'])->assertOk();
});

it('reads and sets the agent configuration of a bot as a whole', function () {
    $bot = User::factory()->bot(User::factory()->create())->create();
    [$runner] = AgentWorld::runner();
    $this->actingAs($this->admin);

    $this->getJson("/api/v1/bots/{$bot->id}/agent")->assertOk()->assertJsonPath('data', [
        'bot_id' => $bot->id, 'enabled' => false, 'runner_ids' => [], 'cli' => 'claude', 'model' => 'sonnet', 'models' => [], 'updated_at' => null,
    ]);
    $this->getJson("/api/v1/bots/{$this->admin->id}/agent")->assertNotFound();
    $this->putJson("/api/v1/bots/{$this->admin->id}/agent", [])->assertNotFound();

    $body = ['enabled' => true, 'runner_ids' => [strtoupper($runner->id)], 'cli' => 'claude', 'model' => 'opus', 'models' => ['review' => 'haiku', 'comment' => 'haiku']];
    $saved = $this->putJson("/api/v1/bots/{$bot->id}/agent", $body)->assertOk()->json('data');
    expect($saved)->toMatchArray(['enabled' => true, 'runner_ids' => [$runner->id], 'model' => 'opus', 'models' => ['comment' => 'haiku', 'review' => 'haiku']])
        ->and(eventsOf(EventType::AgentConfigUpdated)->sole()->changes['enabled'])->toBe(['old' => false, 'new' => true]);

    // the answer sent back changes nothing
    $this->putJson("/api/v1/bots/{$bot->id}/agent", $saved)->assertOk();
    expect(eventsOf(EventType::AgentConfigUpdated)->count())->toBe(1);

    $this->putJson("/api/v1/bots/{$bot->id}/agent", [...$body, 'cli' => 'codex', 'runner_ids' => ['nope'], 'models' => ['deploy' => 'x']])->assertUnprocessable()
        ->assertJsonValidationErrors(['model', 'runner_ids.0', 'models']);
    $this->putJson("/api/v1/bots/{$bot->id}/agent", ['enabled' => 'maybe'])->assertUnprocessable()
        ->assertJsonValidationErrors(['enabled', 'runner_ids', 'cli', 'model', 'models']);
});

it('switches only a bot on that can be an agent', function () {
    $this->actingAs($this->admin);
    $on = ['enabled' => true, 'runner_ids' => [], 'cli' => 'claude', 'model' => 'sonnet', 'models' => []];
    $orphan = User::factory()->bot()->create();
    $disabled = User::factory()->bot($this->admin)->create(['disabled_at' => now()]);

    $this->putJson('/api/v1/bots/'.User::defaultBot()->id.'/agent', $on)->assertUnprocessable()->assertJsonPath('errors.enabled.0', __('field.enabled.default_bot'));
    $this->putJson("/api/v1/bots/{$orphan->id}/agent", $on)->assertUnprocessable()->assertJsonPath('errors.enabled.0', __('field.enabled.no_owner'));
    $this->putJson("/api/v1/bots/{$disabled->id}/agent", $on)->assertUnprocessable()->assertJsonPath('errors.enabled.0', __('field.enabled.disabled'));
    $this->putJson("/api/v1/bots/{$orphan->id}/agent", [...$on, 'enabled' => false])->assertOk();
});

it('queues runs only of agents that are on and of their own project', function () {
    $agent = AgentWorld::agent([$this->project], ['models' => ['correction' => 'opus']]);
    $item = WorkItem::factory()->create(['project_id' => $this->project->id]);
    $system = Actor::system(User::defaultBot(), 'test');

    expect(EnqueueRun::run($system, $agent, $this->project, $item, 'correction', null)->only(['model', 'model_source']))->toBe(['model' => 'opus', 'model_source' => 'bot'])
        ->and(fn () => EnqueueRun::run($system, $agent, $this->project, $item, 'deploy', null))->toThrow(InvalidArgumentException::class)
        ->and(fn () => EnqueueRun::run($system, $agent, Project::factory()->create(), $item, 'task', null))->toThrow(InvalidArgumentException::class);

    AgentConfig::query()->where('bot_id', $agent->id)->update(['enabled' => false]);
    expect(fn () => EnqueueRun::run($system, $agent, $this->project, $item, 'task', null))->toThrow(Problem::class);
    $bare = User::factory()->bot($this->admin)->create();
    expect(fn () => EnqueueRun::run($system, $bare, $this->project, $item, 'task', null))->toThrow(Problem::class);
});

it('starts a run again that ended without success and refuses one that did not', function () {
    $agent = AgentWorld::agent([$this->project]);
    $failed = AgentWorld::run($agent, $this->project, attributes: ['status' => RunStatus::Failed, 'head_sha' => 'abc1234', 'context' => ['pr' => 3]]);
    $this->actingAs($this->admin);

    $again = $this->postJson("/api/v1/runs/{$failed->id}/retry")->assertCreated()->json('data');
    // no runner has the CLI yet: it waits
    expect($again)->toMatchArray(['type' => 'task', 'status' => 'waiting', 'head_sha' => 'abc1234', 'work_item_id' => $failed->work_item_id])
        ->and(AgentRun::query()->find($again['id'])?->context)->toBe(['pr' => 3, 'retry_of' => $failed->id]);
    $this->postJson("/api/v1/runs/{$again['id']}/retry")->assertConflict()->assertJsonPath('reason', 'run_not_retryable');
    $this->postJson("/api/v1/runs/{$again['id']}/cancel")->assertOk()->assertJsonPath('data.status', 'canceled');
    $this->postJson("/api/v1/runs/{$again['id']}/cancel")->assertConflict()->assertJsonPath('reason', 'run_finished');

    // a run deleted meanwhile is gone
    $gone = AgentWorld::run($agent, $this->project, attributes: ['status' => RunStatus::Failed]);
    DB::table('agent_runs')->where('id', $gone->id)->delete();
    expect(fn () => RetryRun::run(actor($this->admin), $gone))->toThrow(Problem::class);
});

it('lets the reaper pass over a run that ended while it looked', function () {
    $agent = AgentWorld::agent([$this->project]);
    [$runner] = AgentWorld::runner();
    $run = AgentRun::factory()->running($runner, now()->subMinutes(5))->create(['bot_id' => $agent->id, 'work_item_id' => WorkItem::factory()->create(['project_id' => $this->project->id])->id]);
    $done = false;
    DB::connection()->beforeExecuting(function (string $query) use ($run, &$done) {
        if (! $done && str_contains($query, 'from `agent_runs`') && str_ends_with($query, 'for update')) {
            $done = true;
            DB::table('agent_runs')->where('id', $run->id)->update(['status' => 'succeeded']);
        }
    });

    expect(ReapLostRuns::run(Actor::system(User::defaultBot(), 'test')))->toMatchArray(['timed_out' => 0, 'requeued' => 0, 'lost' => 0]);
});

it('tells the project of a run live, naming its item', function () {
    consumers(LiveConsumer::class);
    $broadcasts = broadcasts();
    $agent = AgentWorld::agent([$this->project]);
    $item = WorkItem::factory()->create(['project_id' => $this->project->id]);

    EnqueueRun::run(Actor::system(User::defaultBot(), 'test'), $agent, $this->project, $item, 'task', null);

    $message = collect($broadcasts->sent())->sole(fn (array $sent) => $sent['payload']['type'] === 'agent_run.queued');
    expect($message['channels'])->toBe(["private-project.{$this->project->id}"])
        ->and($message['payload']['item_id'])->toBe($item->id);
});
