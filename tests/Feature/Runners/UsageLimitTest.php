<?php

use App\Actions\AgentRuns\EnqueueRun;
use App\Actions\AgentRuns\ReapLostRuns;
use App\Domain\Agents\RunStatus;
use App\Events\EventType;
use App\Models\AgentConfig;
use App\Models\AgentThread;
use App\Models\Project;
use App\Models\User;
use App\Models\WorkItem;
use App\Support\Actor;
use App\Support\RunQueue;
use Tests\Support\AgentWorld;

/*
 * The usage of the Claude subscription (WEBU-65): a runner reports it with its claims and heartbeats, an org admin sets a
 * limit in percent; from it on (session or week) the runner takes no new runs of `claude`, they wait with
 * `usage_limit`. Without a known usage no limit holds.
 */

$claim = fn (string $token, array $report = []) => test()->postJson('/api/runner/claim', $report, AgentWorld::headers($token));
$system = fn () => Actor::system(User::defaultBot(), 'test');
$usage = fn (?float $session, ?float $week) => ['usage' => [
    'session' => $session === null ? null : ['percent' => $session, 'resets_at' => '2026-11-27T19:00:00.5+01:00'],
    'week' => $week === null ? null : ['percent' => $week, 'resets_at' => null],
]];

beforeEach(function () {
    $this->project = Project::factory()->identifier('WEB')->create();
    $this->agent = AgentWorld::agent([$this->project]);
});

it('keeps the usage of a report, in UTC, and a part left out keeps the last one', function () use ($claim, $usage) {
    [$runner, $token] = AgentWorld::runner();

    $claim($token, $usage(42.5, 65))->assertOk();
    expect($runner->refresh()->usage)->toBe([
        'session' => ['percent' => 42.5, 'resets_at' => '2026-11-27T18:00:00.500000Z'],
        'week' => ['percent' => 65, 'resets_at' => null],
    ]);

    $claim($token)->assertOk();
    expect($runner->refresh()->usage['week']['percent'])->toBe(65);

    // nothing known: both windows null
    $claim($token, $usage(null, null))->assertOk();
    expect($runner->refresh()->usage)->toBe(['session' => null, 'week' => null]);

    $claim($token, ['usage' => ['week' => ['percent' => 101], 'month' => null]])->assertUnprocessable()
        ->assertJsonValidationErrors(['usage', 'usage.week.percent']);
});

it('sets and clears the limit of a runner over REST and shows whether it holds', function () use ($usage) {
    [$runner] = AgentWorld::runner(['usage' => $usage(81, 20)['usage']]);
    $this->actingAs(User::factory()->admin()->create());

    $this->getJson("/api/v1/runners/{$runner->id}")->assertOk()->assertJsonPath('data.usage_limit', null)->assertJsonPath('data.over_usage_limit', false)
        ->assertJsonPath('data.usage.session.percent', 81);
    $this->patchJson("/api/v1/runners/{$runner->id}", ['usage_limit' => 80])->assertOk()
        ->assertJsonPath('data.usage_limit', 80)->assertJsonPath('data.over_usage_limit', true);
    expect(eventsOf(EventType::RunnerUpdated, $runner)->sole()->changes)->toBe(['usage_limit' => ['old' => null, 'new' => 80]]);

    foreach ([0, 101, 'viel', 12.5] as $wrong) {
        $this->patchJson("/api/v1/runners/{$runner->id}", ['usage_limit' => $wrong])->assertUnprocessable()
            ->assertJsonPath('errors.usage_limit.0', __('field.usage_limit.invalid'));
    }
    $this->patchJson("/api/v1/runners/{$runner->id}", ['usage_limit' => null])->assertOk()->assertJsonPath('data.usage_limit', null);
    expect(eventsOf(EventType::RunnerUpdated, $runner)->count())->toBe(2);
});

it('hands no claude run to a runner at its limit, lets the run wait with usage_limit and hands it again below', function () use ($claim, $system, $usage) {
    [$runner, $token] = AgentWorld::runner(['usage_limit' => 80]);
    $codex = AgentWorld::agent([$this->project], ['cli' => 'codex', 'model' => 'gpt-5-codex'], 'Otto');
    $runner->forceFill(['clis' => [...$runner->clis, ['cli' => 'codex', 'installed' => true, 'version' => '1', 'logged_in' => true, 'path' => null]]])->save();
    $item = WorkItem::factory()->create(['project_id' => $this->project->id]);
    $run = EnqueueRun::run($system(), $this->agent, $this->project, $item, 'task', null);
    $other = EnqueueRun::run($system(), $codex, $this->project, $item, 'comment', null);

    // the week reached the limit: the claude run stays, a codex run still goes
    $claim($token, $usage(10, 80))->assertOk()->assertJsonPath('run.id', $other->id);
    $claim($token)->assertOk()->assertJsonPath('run', null);
    ReapLostRuns::run($system());
    expect([$run->fresh()->status, $run->fresh()->waiting_reason])->toBe([RunStatus::Waiting, 'usage_limit']);

    // a second runner below its limit could take it: the run does not wait for the first one
    [$second] = AgentWorld::runner(['usage_limit' => 80, 'usage' => $usage(79, 79)['usage']]);
    ReapLostRuns::run($system());
    expect([$run->fresh()->status, $run->fresh()->waiting_reason])->toBe([RunStatus::Queued, null]);
    $second->forceFill(['revoked_at' => now()])->save();

    // below it again (or nothing known): the run goes
    $claim($token, $usage(null, null))->assertOk()->assertJsonPath('run.id', $run->id);
});

it('lets a run of a strand wait with usage_limit while the runner of its strand is at its limit', function () use ($usage) {
    [$runner] = AgentWorld::runner(['usage_limit' => 50, 'usage' => $usage(50, 0)['usage']]);
    [$free] = AgentWorld::runner();
    $run = AgentWorld::run($this->agent, $this->project);
    $thread = AgentThread::factory()->create(['bot_id' => $this->agent->id, 'work_item_id' => $run->work_item_id, 'runner_id' => $runner->id]);
    $run->forceFill(['thread_id' => $thread->id])->save();
    $config = AgentConfig::query()->where('bot_id', $this->agent->id)->sole();

    expect(RunQueue::waitingReason($run->fresh(['thread.runner']), $config, collect([$runner, $free])))->toBe(RunQueue::USAGE_LIMIT);
    $runner->forceFill(['usage_limit' => null])->save();
    expect(RunQueue::waitingReason($run->fresh(['thread.runner']), $config, collect([$runner, $free])))->toBeNull();
});
