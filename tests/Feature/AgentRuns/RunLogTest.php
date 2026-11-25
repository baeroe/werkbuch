<?php

use App\Domain\Agents\RunStatus;
use App\Jobs\SendRunLog;
use App\Live\RunLog;
use App\Models\AgentRun;
use App\Models\AgentRunEvent;
use App\Models\Project;
use App\Models\User;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Queue;
use Illuminate\Support\Str;
use Tests\Support\AgentWorld;

/*
 * The log of a run at its item (WEBU-28, A641): read from a line on (`filter[after]`), told live on the channel of the
 * item at most once a run and second, the last lines never left untold; and when the runner was last seen.
 */

beforeEach(function () {
    $this->project = Project::factory()->create();
    $this->agent = AgentWorld::agent([$this->project]);
    [$this->runner, $this->token] = AgentWorld::runner();
    $this->admin = User::factory()->admin()->create();
});

/** Queues a run of the agent and lets the runner of the test claim it. */
$claimed = function (): AgentRun {
    $run = AgentWorld::run(test()->agent, test()->project);
    test()->postJson('/api/runner/claim', [], AgentWorld::headers(test()->token))->assertOk();

    return $run->fresh();
};

$log = fn (AgentRun $run, string ...$texts) => test()->postJson("/api/runner/runs/{$run->id}/events", [
    'attempt' => 1, 'events' => array_map(fn (string $text) => ['kind' => 'text', 'text' => $text], $texts),
], AgentWorld::headers(test()->token))->assertOk();

it('answers the lines after a line', function () use ($claimed, $log) {
    Queue::fake([SendRunLog::class]);
    $run = $claimed();
    $log($run, 'one', 'two', 'three');
    $lines = AgentRunEvent::query()->where('run_id', $run->id)->orderBy('id')->pluck('id')->all();

    $after = fn (string $after) => $this->actingAs($this->admin)->getJson("/api/v1/runs/{$run->id}/events?filter[after]={$after}")->assertOk();

    $after($lines[0])->assertJsonPath('meta.total', 2)->assertJsonPath('data.0.text', 'two')->assertJsonPath('data.1.text', 'three');
    $after(strtoupper($lines[1]))->assertJsonPath('meta.total', 1)->assertJsonPath('data.0.text', 'three');
    $after($lines[2])->assertJsonPath('meta.total', 0);
    // a text that is no ULID matches nothing, as every filter by ULID (A96)
    $after('nope')->assertJsonPath('meta.total', 0);
    $this->getJson("/api/v1/runs/{$run->id}/events?filter[after]=")->assertOk()->assertJsonPath('meta.total', 3);
    // the log keeps its order: no sort
    $this->getJson("/api/v1/runs/{$run->id}/events?sort=id")->assertUnprocessable()->assertJsonValidationErrors(['sort']);
});

it('says when the runner of a run was last seen', function () use ($claimed) {
    Queue::fake([SendRunLog::class]);
    $run = $claimed();
    $seen = $this->runner->fresh()->last_seen_at;

    $this->actingAs($this->admin)->getJson("/api/v1/runs/{$run->id}")->assertOk()
        ->assertJsonPath('data.runner_last_seen_at', $seen?->toJSON());
    $waiting = AgentWorld::run($this->agent, $this->project);
    $this->getJson("/api/v1/runs/{$waiting->id}")->assertOk()->assertJsonPath('data.runner_last_seen_at', null);
});

it('tells the item of new lines at once, then once at the end of the pause', function () use ($claimed, $log) {
    Queue::fake([SendRunLog::class]);
    $broadcasts = broadcasts();
    $run = $claimed();

    $log($run, 'one');
    expect($broadcasts->sent())->toHaveCount(1)
        ->and($broadcasts->sent()[0]['channels'])->toBe(["private-work-item.{$run->work_item_id}"])
        ->and($broadcasts->sent()[0]['payload'])->toBe([
            'event_id' => null, 'type' => 'agent_run.log', 'project_id' => $run->project_id, 'page_id' => null, 'template_id' => null,
            'item_id' => $run->work_item_id, 'comment_id' => null, 'actor_id' => null, 'run_id' => $run->id,
        ]);
    Queue::assertNothingPushed();

    // within the pause: no message, one job for the end of it (the second within it is kept away by the waiting one)
    $log($run, 'two');
    $log($run, 'three');
    expect($broadcasts->sent())->toHaveCount(1);
    Queue::assertPushedOn('live', SendRunLog::class, fn (SendRunLog $job) => $job->runId === $run->id && $job->delay !== null);

    // the job tells the item and starts a pause of its own
    (new SendRunLog($run->id))->handle();
    expect($broadcasts->sent())->toHaveCount(2)
        ->and($broadcasts->sent()[1]['payload']['run_id'])->toBe($run->id)
        ->and(Cache::has("run-log:{$run->id}"))->toBeTrue();

    $this->travel(2)->seconds();
    $log($run, 'four');
    expect($broadcasts->sent())->toHaveCount(3);
});

it('tells nobody of a run without an item, a run that is gone, or lines that were rolled back', function () {
    $broadcasts = broadcasts();
    Queue::fake([SendRunLog::class]);
    $lonely = AgentWorld::run($this->agent, $this->project, attributes: ['work_item_id' => null, 'status' => RunStatus::Running]);

    RunLog::grew($lonely);
    RunLog::send($lonely);
    (new SendRunLog((string) Str::ulid()))->handle();

    $run = AgentWorld::run($this->agent, $this->project);
    DB::beginTransaction();
    RunLog::grew($run);
    DB::rollBack();

    expect($broadcasts->sent())->toBe([]);
    Queue::assertNothingPushed();
});

it('keeps the request answering when Reverb fails', function () use ($claimed, $log) {
    Queue::fake([SendRunLog::class]);
    $broadcasts = broadcasts();
    $broadcasts->failWith(new RuntimeException('down'));
    $run = $claimed();

    $log($run, 'one');

    expect(AgentRunEvent::query()->where('run_id', $run->id)->count())->toBe(1);
});
