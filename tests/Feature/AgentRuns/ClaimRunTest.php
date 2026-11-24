<?php

use App\Access\ProjectRole;
use App\Access\RoleAssignments;
use App\Actions\AgentRuns\ClaimRun;
use App\Actions\AgentRuns\EnqueueRun;
use App\Actions\AgentRuns\ReapLostRuns;
use App\Domain\Agents\Contract;
use App\Domain\Agents\RunStatus;
use App\Domain\Agents\RunType;
use App\Events\EventType;
use App\Models\AgentRun;
use App\Models\AgentThread;
use App\Models\PersonalAccessToken;
use App\Models\Project;
use App\Models\User;
use App\Models\WorkItem;
use App\Support\Actor;
use Illuminate\Support\Facades\DB;
use App\Support\RunPrompts;
use Tests\Support\AgentWorld;

/*
 * Claiming (spec 6.3, 8.8, 9): the report of the runner becomes its last state, werkbuch hands it the next run it may
 * take within its places, for an agent of its pool with the CLI signed in, conflicts, corrections and reviews first; a
 * correction or comment at a strand goes to the strand's runner until it has been offline for 30 minutes.
 */

$claim = fn (string $token, array $report = [], int $protocol = 1) => test()->postJson('/api/runner/claim', $report, AgentWorld::headers($token, $protocol));
$system = fn () => Actor::system(User::defaultBot(), 'test');

beforeEach(function () {
    $this->project = Project::factory()->identifier('WEB')->create();
    $this->agent = AgentWorld::agent([$this->project]);
});

it('answers 200 with run null, the places and the version when there is no run', function () use ($claim) {
    [, $token] = AgentWorld::runner();

    $claim($token)->assertOk()->assertExactJson([
        'run' => null,
        'places' => ['total' => 2, 'per_repo' => 1, 'light' => 2, 'used' => ['total' => 0, 'per_repo' => 0, 'light' => 0]],
        'version' => config('werkbuch.version'),
        'protocol' => 1,
        'heartbeat_seconds' => 15,
    ]);
});

it('hands a queued run with everything the runner needs and starts it', function () use ($claim, $system) {
    [$runner, $token] = AgentWorld::runner();
    $item = WorkItem::factory()->create(['project_id' => $this->project->id, 'title' => 'Login mit Passkey']);
    $thread = AgentThread::factory()->create(['bot_id' => $this->agent->id, 'work_item_id' => $item->id, 'project_id' => $this->project->id]);
    $run = EnqueueRun::run($system(), $this->agent, $this->project, $item, 'task', $thread);
    $this->freezeSecond();

    $answer = $claim($token)->assertOk()->json();
    $plain = $answer['run']['werkbuch']['token'];
    $run->refresh();

    expect($answer['run'])->toMatchArray([
        'id' => $run->id, 'attempt' => 1, 'type' => 'task', 'cli' => 'claude', 'model' => 'sonnet', 'model_source' => 'default',
        'timeout_minutes' => 60, 'deadline_at' => now()->addHour()->toJSON(), 'lease_expires_at' => now()->addMinute()->toJSON(),
        'project' => ['id' => $this->project->id, 'identifier' => 'WEB'],
        'item' => ['id' => $item->id, 'key' => $item->key, 'title' => 'Login mit Passkey'],
        'thread' => ['id' => $thread->id, 'branch' => "agent/{$item->key}-login-mit-passkey", 'base_branch' => 'main', 'worktree' => null, 'session_id' => null],
        'head_sha' => null, 'setup_command' => null, 'teardown_command' => null, 'git' => null,
        'commit_identity' => ['name' => 'Kira', 'email' => $this->agent->handle.'@users.noreply.'.parse_url(config('app.url'), PHP_URL_HOST)],
        'system_prompt' => RunPrompts::for($run)['system_prompt'],
        'prompt' => RunPrompts::for($run)['prompt'],
    ])
        ->and($answer['run']['system_prompt'])->toStartWith("# Contract\n\n".Contract::for(RunType::Task))
        ->and($answer['run']['prompt'])->toContain("Run `task` for the item {$item->key} „Login mit Passkey“")
        ->and($answer['run']['werkbuch'])->toMatchArray(['mcp_url' => url('/mcp'), 'server_name' => 'werkbuch-run'])
        ->and(PersonalAccessToken::findToken($plain)?->agent_run_id)->toBe($run->id)
        ->and($answer['places']['used'])->toBe(['total' => 1, 'per_repo' => 1, 'light' => 0])
        ->and([$run->status, $run->runner_id, $run->started_at?->toJSON()])->toBe([RunStatus::Running, $runner->id, now()->toJSON()])
        ->and($thread->fresh()->runner_id)->toBe($runner->id)
        ->and(eventsOf(EventType::AgentRunStarted, $run)->sole()->actor_id)->toBe($this->agent->id)
        ->and(eventsOf(EventType::AgentRunStarted, $run)->sole()->meta)->toMatchArray(['via' => 'automation', 'reason' => 'agent', 'item_id' => $item->id]);

    // the token of the run works against werkbuch, with the abilities of a task
    $this->withToken($plain)->getJson("/api/v1/work-items/{$item->id}")->assertOk();
    $claim($token)->assertOk()->assertJsonPath('run', null);
});

it('gives a review no strand and takes the models of the agent', function () use ($claim) {
    [, $token] = AgentWorld::runner();
    $agent = AgentWorld::agent([$this->project], ['model' => 'opus', 'models' => ['review' => 'haiku']], 'Otto');
    $thread = AgentThread::factory()->create(['bot_id' => $agent->id, 'project_id' => $this->project->id, 'session_id' => 'abc']);
    $review = EnqueueRun::run(actor($agent), $agent, $this->project, null, 'review', $thread, ['head_sha' => 'abc1234', 'pr' => 12]);

    $answer = $claim($token)->assertOk()->json('run');

    expect($answer)->toMatchArray(['id' => $review->id, 'type' => 'review', 'model' => 'haiku', 'model_source' => 'bot', 'item' => null, 'thread' => null, 'head_sha' => 'abc1234', 'timeout_minutes' => 20])
        ->and($answer['prompt'])->toContain('It names no item of the project.')
        ->and($review->fresh()->context)->toBe(['pr' => 12])
        ->and(PersonalAccessToken::findToken($answer['werkbuch']['token'])?->abilities)->toBe(['read', 'mcp']);
});

it('sends the places and stores the last load, CLIs and equipment with every claim and heartbeat', function () use ($claim, $system) {
    [$runner, $token] = AgentWorld::runner(['slots_total' => 3, 'slots_per_repo' => 2, 'slots_light' => 4]);
    $report = [
        'load' => ['cpu' => 12.5, 'gpu' => null, 'ram_used' => 7.4, 'ram_total' => 24, 'disk_free' => 311, 'disk_total' => 460],
        'clis' => [
            ['cli' => 'claude', 'installed' => true, 'version' => '2.4.1', 'logged_in' => true, 'path' => '/opt/homebrew/bin/claude'],
            ['cli' => 'codex', 'installed' => false, 'version' => null, 'logged_in' => false],
            ['cli' => 'aider', 'installed' => true, 'version' => '1', 'logged_in' => true],
        ],
        'equipment' => ['mcp_servers' => ['context7'], 'skills' => ['do-ticket'], 'plugins' => [], 'werkbuch_access' => ['werkbuch']],
    ];

    $claim($token, $report, 1)->assertOk()->assertJsonPath('places.total', 3)->assertJsonPath('places.per_repo', 2)->assertJsonPath('places.light', 4);
    $runner->refresh();
    expect($runner->load)->toBe($report['load'])
        ->and(array_column($runner->clis, 'cli'))->toBe(['claude', 'codex'])
        ->and($runner->clis[1]['path'])->toBeNull()
        ->and($runner->equipment)->toBe($report['equipment'])
        ->and([$runner->version, $runner->protocol])->toBe(['0.3.2', 1]);

    // a part left out keeps the last one; a heartbeat reports as well
    $run = EnqueueRun::run($system(), $this->agent, $this->project, WorkItem::factory()->create(['project_id' => $this->project->id]), 'task', null);
    $claim($token)->assertJsonPath('run.id', $run->id);
    $this->travel(5)->seconds();
    $this->postJson("/api/runner/runs/{$run->id}/heartbeat", ['attempt' => 1, 'load' => [...$report['load'], 'cpu' => 99]], AgentWorld::headers($token, version: '0.4.0'))->assertOk()
        ->assertJsonPath('places.used.total', 1)->assertJsonPath('version', config('werkbuch.version'));
    $runner->refresh();
    expect($runner->load['cpu'])->toBe(99)
        ->and($runner->equipment)->toBe($report['equipment'])
        ->and($runner->version)->toBe('0.4.0')
        ->and($runner->last_seen_at->toJSON())->toBe(now()->startOfSecond()->toJSON());

    $claim($token, ['load' => ['cpu' => 101]])->assertUnprocessable()->assertJsonValidationErrors(['load.cpu', 'load.gpu', 'load.ram_used']);
    $claim($token, ['clis' => [['cli' => 'claude']], 'equipment' => ['skills' => 'all']])->assertUnprocessable()
        ->assertJsonValidationErrors(['clis.0.installed', 'clis.0.version', 'clis.0.logged_in', 'equipment.skills']);
});

it('hands nothing to a runner of an older protocol', function () use ($claim) {
    [, $token] = AgentWorld::runner();
    AgentWorld::run($this->agent, $this->project);

    $claim($token, protocol: 0)->assertOk()->assertJsonPath('run', null)->assertJsonPath('protocol', 1);
    $this->postJson('/api/runner/claim', [], ['Authorization' => "Bearer {$token}"])->assertOk()->assertJsonPath('run', null);
    $claim($token)->assertOk()->assertJsonPath('run.type', 'task');
});

it('claims only runs within the free places set in werkbuch', function () use ($claim) {
    [$runner, $token] = AgentWorld::runner(['slots_total' => 2, 'slots_per_repo' => 1, 'slots_light' => 1]);
    $other = Project::factory()->create();
    $third = Project::factory()->create();
    foreach ([$other, $third] as $project) {
        app(RoleAssignments::class)->setProjectRole($this->agent, $project, ProjectRole::Member);
    }
    $web = [AgentWorld::run($this->agent, $this->project), AgentWorld::run($this->agent, $this->project)];
    $ops = AgentWorld::run($this->agent, $other);
    $last = AgentWorld::run($this->agent, $third);
    $reviews = [AgentWorld::run($this->agent, $this->project, RunType::Review), AgentWorld::run($this->agent, $this->project, RunType::Comment)];

    // light runs first in the queue, in their own pot: one of two; then one code run per repo, two in all
    expect($claim($token)->json('run.id'))->toBe($reviews[0]->id)
        ->and($claim($token)->json('run.id'))->toBe($web[0]->id)
        ->and($claim($token)->json('run.id'))->toBe($ops->id)
        ->and($claim($token)->json('run'))->toBeNull();

    // more places in werkbuch hold without a restart of the runner
    $runner->forceFill(['slots_total' => 4, 'slots_light' => 2])->save();
    expect($claim($token)->json('run.id'))->toBe($last->id)
        ->and($claim($token)->json('run.id'))->toBe($reviews[1]->id)
        ->and($claim($token)->json('run'))->toBeNull()
        ->and($web[1]->fresh()->status)->toBe(RunStatus::Queued);
});

it('hands a run only to a runner that reports the agent\'s CLI signed in and waits otherwise', function () use ($claim, $system) {
    [$runner, $token] = AgentWorld::runner(['clis' => [['cli' => 'claude', 'installed' => true, 'version' => '2', 'logged_in' => false, 'path' => null]]]);
    $codex = AgentWorld::agent([$this->project], ['cli' => 'codex', 'model' => 'gpt-5-codex'], 'Otto');
    $item = WorkItem::factory()->create(['project_id' => $this->project->id]);

    $run = EnqueueRun::run($system(), $this->agent, $this->project, $item, 'task', null);
    $other = EnqueueRun::run($system(), $codex, $this->project, $item, 'comment', null);
    expect([$run->status, $run->waiting_reason])->toBe([RunStatus::Waiting, 'no_cli'])
        ->and(eventsOf(EventType::AgentRunQueued, $run)->sole()->changes)->toBe(['status' => ['old' => null, 'new' => 'waiting']]);

    $claim($token)->assertOk()->assertJsonPath('run', null);

    // signed in now: the run starts, the codex one keeps waiting until a runner of the pool has codex
    $claim($token, ['clis' => [['cli' => 'claude', 'installed' => true, 'version' => '2', 'logged_in' => true]]])->assertJsonPath('run.id', $run->id);
    ReapLostRuns::run($system());
    expect([$other->fresh()->status, $other->fresh()->waiting_reason])->toBe([RunStatus::Waiting, 'no_cli']);

    [, $second] = AgentWorld::runner(['clis' => [['cli' => 'codex', 'installed' => true, 'version' => '1', 'logged_in' => true, 'path' => null]]]);
    expect(ReapLostRuns::run($system())['waiting'])->toBe(0)
        ->and([$other->fresh()->status, $other->fresh()->waiting_reason])->toBe([RunStatus::Queued, null]);
    $claim($second)->assertJsonPath('run.id', $other->id);
});

it('hands runs of an agent only to the runners of its pool, every runner when it is empty', function () use ($claim) {
    [$pooled, $inPool] = AgentWorld::runner();
    [, $outside] = AgentWorld::runner();
    $pooledAgent = AgentWorld::agent([$this->project], ['runner_ids' => [$pooled->id]], 'Otto');
    $run = AgentWorld::run($pooledAgent, $this->project);
    $free = AgentWorld::run($this->agent, $this->project);

    expect($claim($outside)->json('run.id'))->toBe($free->id)
        ->and($claim($outside)->json('run'))->toBeNull()
        ->and($claim($inPool)->json('run.id'))->toBe($run->id);

    $off = AgentWorld::agent([$this->project], ['enabled' => false], 'Ida');
    AgentWorld::run($off, $this->project);
    expect($claim($inPool)->json('run'))->toBeNull();
});

it('orders conflicts, corrections and reviews before tasks, then priority, then age', function () use ($claim) {
    [, $token] = AgentWorld::runner(['slots_total' => 9, 'slots_per_repo' => 9, 'slots_light' => 9]);
    $item = fn (string $priority) => WorkItem::factory()->create(['project_id' => $this->project->id, 'priority' => $priority]);
    $oldTask = AgentWorld::run($this->agent, $item('low'));
    $urgentTask = AgentWorld::run($this->agent, $item('urgent'));
    $comment = AgentWorld::run($this->agent, $item('high'), RunType::Comment);
    $review = AgentWorld::run($this->agent, $this->project, RunType::Review, ['work_item_id' => null]);
    $correction = AgentWorld::run($this->agent, $item('high'), RunType::Correction);
    $conflict = AgentWorld::run($this->agent, $item('none'), RunType::Conflict);

    $order = array_map(fn () => $claim($token)->json('run.id'), range(1, 6));

    // the three urgent kinds by priority (a review without an item has none), then by age; then tasks and comments
    expect($order)->toBe([$correction->id, $review->id, $conflict->id, $urgentTask->id, $comment->id, $oldTask->id]);
});

it('hands a correction or comment of an open thread to the runner of the thread, waits while it is offline and moves the thread after the grace period', function () use ($claim, $system) {
    [$home, $homeToken] = AgentWorld::runner();
    [, $otherToken] = AgentWorld::runner();
    $item = WorkItem::factory()->create(['project_id' => $this->project->id]);
    $thread = AgentThread::factory()->create(['bot_id' => $this->agent->id, 'work_item_id' => $item->id, 'project_id' => $this->project->id, 'runner_id' => $home->id, 'session_id' => 'sess-1', 'branch' => 'agent/x']);
    $correction = EnqueueRun::run($system(), $this->agent, $this->project, $item, 'correction', $thread);
    $comment = EnqueueRun::run($system(), $this->agent, $this->project, $item, 'comment', $thread);
    $review = EnqueueRun::run($system(), $this->agent, $this->project, $item, 'review', $thread);

    // another runner gets only the review
    expect($claim($otherToken)->json('run.id'))->toBe($review->id)
        ->and($claim($otherToken)->json('run'))->toBeNull();
    $this->postJson("/api/runner/runs/{$review->id}/result", ['attempt' => 1, 'status' => 'succeeded', 'verdict' => 'approve'], AgentWorld::headers($otherToken))->assertOk();

    // the runner of the strand goes quiet: its runs wait for it
    $this->travel(5)->minutes();
    ReapLostRuns::run($system());
    expect([$correction->fresh()->status, $correction->fresh()->waiting_reason])->toBe([RunStatus::Waiting, 'runner_offline'])
        ->and($claim($otherToken)->json('run'))->toBeNull();

    // past 30 minutes offline another runner takes the strand over with a fresh session
    $this->travel(26)->minutes();
    $answer = $claim($otherToken)->json('run');
    expect($answer['id'])->toBe($correction->id)
        ->and($answer['thread'])->toMatchArray(['id' => $thread->id, 'branch' => 'agent/x', 'session_id' => null])
        ->and($thread->fresh()->runner_id)->not->toBe($home->id);

    // one run at a strand at a time (spec 7.8, A488): the comment waits for the correction, even in the light pot
    expect($claim($otherToken)->json('run'))->toBeNull();
    $this->postJson("/api/runner/runs/{$correction->id}/result", ['attempt' => 1, 'status' => 'succeeded'], AgentWorld::headers($otherToken))->assertOk();

    // then it follows the strand to its new runner; the old one, back again, gets nothing of it
    $claim($homeToken)->assertJsonPath('run', null);
    expect($claim($otherToken)->json('run.id'))->toBe($comment->id);
});

it('never runs two runs of a strand at once, also with places for both', function () use ($claim, $system) {
    [$runner, $token] = AgentWorld::runner(['slots_total' => 4, 'slots_per_repo' => 4, 'slots_light' => 4]);
    $item = WorkItem::factory()->create(['project_id' => $this->project->id]);
    $thread = AgentThread::factory()->create(['bot_id' => $this->agent->id, 'work_item_id' => $item->id, 'project_id' => $this->project->id]);
    $first = EnqueueRun::run($system(), $this->agent, $this->project, $item, 'correction', $thread);
    $second = EnqueueRun::run($system(), $this->agent, $this->project, $item, 'conflict', $thread);
    $review = EnqueueRun::run($system(), $this->agent, $this->project, $item, 'review', $thread);
    $other = AgentWorld::run($this->agent, $this->project);

    // the first run of the strand, then the review (no strand) and a run elsewhere, never the second of the strand
    $order = array_map(fn () => $claim($token)->json('run.id'), range(1, 4));
    expect($order)->toBe([$first->id, $review->id, $other->id, null])
        ->and($thread->fresh()?->runner_id)->toBe($runner->id);

    $this->postJson("/api/runner/runs/{$first->id}/result", ['attempt' => 1, 'status' => 'failed', 'error' => 'tests red'], AgentWorld::headers($token))->assertOk();
    expect($claim($token)->json('run.id'))->toBe($second->id);
});

it('hands no run of a project being deleted', function () use ($claim) {
    [, $token] = AgentWorld::runner();
    AgentWorld::run($this->agent, $this->project);
    $this->project->update(['deleting_at' => now()]);

    expect($claim($token)->json('run'))->toBeNull();
});

it('finds the run for this runner behind a full queue of runs it cannot take', function () use ($claim) {
    [, $token] = AgentWorld::runner();
    $codex = AgentWorld::agent([$this->project], ['cli' => 'codex', 'model' => 'gpt-5-codex'], 'Otto');
    $item = WorkItem::factory()->create(['project_id' => $this->project->id, 'priority' => 'urgent']);
    AgentRun::factory()->type(RunType::Task)->count(ClaimRun::CANDIDATES + 5)->create([
        'bot_id' => $codex->id, 'cli' => 'codex', 'model' => 'gpt-5-codex', 'work_item_id' => $item->id, 'project_id' => $this->project->id,
    ]);
    $mine = AgentWorld::run($this->agent, $this->project);

    expect($claim($token)->json('run.id'))->toBe($mine->id);
});

it('says agent_off for the waiting runs of an agent switched off and hands them again once it is on', function () use ($claim) {
    [, $token] = AgentWorld::runner();
    $run = AgentWorld::run($this->agent, $this->project);
    $admin = User::factory()->admin()->create();
    $config = fn (bool $on) => ['enabled' => $on, 'runner_ids' => [], 'cli' => 'claude', 'model' => 'sonnet', 'models' => []];
    $this->actingAs($admin);

    $this->putJson("/api/v1/bots/{$this->agent->id}/agent", $config(false))->assertOk();
    expect([$run->fresh()?->status, $run->fresh()?->waiting_reason])->toBe([RunStatus::Waiting, 'agent_off'])
        ->and($claim($token)->json('run'))->toBeNull();

    $this->putJson("/api/v1/bots/{$this->agent->id}/agent", $config(true))->assertOk();
    expect([$run->fresh()?->status, $run->fresh()?->waiting_reason])->toBe([RunStatus::Queued, null])
        ->and($claim($token)->json('run.id'))->toBe($run->id);
});

it('leaves a run whose agent was switched off while the claim looked (A488)', function () use ($claim) {
    [, $token] = AgentWorld::runner();
    $run = AgentWorld::run($this->agent, $this->project);
    $switched = false;
    DB::connection()->beforeExecuting(function (string $query) use (&$switched) {
        if (! $switched && str_starts_with($query, 'select * from `agent_configs`') && str_ends_with($query, 'lock in share mode')) {
            $switched = true;
            DB::table('agent_configs')->where('bot_id', test()->agent->id)->update(['enabled' => false]);
        }
    });

    expect($claim($token)->json('run'))->toBeNull()
        ->and($switched)->toBeTrue()
        ->and($run->fresh()?->status->pending())->toBeTrue();
});

it('leaves a run whose project is deleted while the claim looked, reading the project under a lock (A489)', function () use ($claim) {
    [, $token] = AgentWorld::runner();
    $run = AgentWorld::run($this->agent, $this->project);
    $deleted = false;
    DB::connection()->beforeExecuting(function (string $query) use (&$deleted) {
        if (! $deleted && str_starts_with($query, 'select * from `projects`') && str_ends_with($query, 'lock in share mode')) {
            $deleted = true;
            DB::table('projects')->where('id', test()->project->id)->update(['deleting_at' => now()]);
        }
    });

    expect($claim($token)->json('run'))->toBeNull()
        ->and($deleted)->toBeTrue()
        ->and($run->fresh()?->status->pending())->toBeTrue();
});

it('passes over the other runs of a strand once one of them could not start (A488)', function () use ($claim, $system) {
    [, $token] = AgentWorld::runner(['slots_total' => 4, 'slots_per_repo' => 4]);
    $item = WorkItem::factory()->create(['project_id' => $this->project->id]);
    $thread = AgentThread::factory()->create(['bot_id' => $this->agent->id, 'work_item_id' => $item->id, 'project_id' => $this->project->id]);
    EnqueueRun::run($system(), $this->agent, $this->project, $item, 'correction', $thread);
    EnqueueRun::run($system(), $this->agent, $this->project, $item, 'conflict', $thread);
    $switched = false;
    $locked = 0;
    DB::connection()->beforeExecuting(function (string $query) use (&$switched, &$locked) {
        if (str_starts_with($query, 'select * from `agent_runs`') && str_ends_with($query, 'for update')) {
            $locked++;
        }
        // the agent goes off while the claim holds the first run of the strand
        if (! $switched && str_starts_with($query, 'select * from `agent_configs`') && str_ends_with($query, 'lock in share mode')) {
            $switched = true;
            DB::table('agent_configs')->where('bot_id', test()->agent->id)->update(['enabled' => false]);
        }
    });

    expect($claim($token)->json('run'))->toBeNull()
        ->and($locked)->toBe(1);
});
