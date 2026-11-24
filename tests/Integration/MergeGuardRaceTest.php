<?php

use App\Actions\AgentRuns\FinishRun;
use App\Actions\GitHub\DetectUnauthorizedPush;
use App\Domain\Agents\RunStatus;
use App\Domain\Agents\RunType;
use App\Models\AgentRun;
use App\Models\AgentThread;
use App\Models\Project;
use App\Models\ProjectRepository;
use App\Models\User;
use App\Models\WorkItem;
use App\Support\Actor;
use Tests\Support\AgentWorld;
use Tests\Support\FakeGitHub;
use Tests\Support\RaceConnections;

/*
 * The typical case of an unauthorized merge (spec 11.3): the run pushes, then reports its result while the push comes.
 * Both lock the run before its strand (FinishRun: run, then the session of the strand; the guard: repo row, runs,
 * strands), so one waits for the other at the run and neither deadlocks.
 */

beforeEach(fn () => RaceConnections::setUp());

afterEach(fn () => RaceConnections::tearDown());

it('lets the guard wait at the run while the run reports its result, then pauses the strand', function () {
    FakeGitHub::connected();
    $project = Project::factory()->create();
    $agent = AgentWorld::agent([$project]);
    $link = FakeGitHub::link($project);
    $item = WorkItem::factory()->create(['project_id' => $project->id]);
    $thread = AgentThread::factory()->create(['bot_id' => $agent->id, 'project_id' => $project->id, 'work_item_id' => $item->id]);
    [$runner] = AgentWorld::runner();
    $run = AgentWorld::run($agent, $item, RunType::Task, ['status' => RunStatus::Running, 'runner_id' => $runner->id, 'thread_id' => $thread->id, 'started_at' => now(), 'lease_expires_at' => now()->addMinutes(5)]);
    $bot = fn () => Actor::system(User::defaultBot(), 'test');

    // the run reports its result (and the session of its strand) and holds its transaction open ...
    RaceConnections::hold(fn () => FinishRun::run($bot(), $runner, $run->id, ['attempt' => 1, 'status' => 'succeeded', 'commit' => 'a41c9e7', 'session_id' => 'session-1']));

    // ... the push comes: the guard locks the repo row, then waits for the run (never for the strand first)
    RaceConnections::releaseBeforeLock('agent_runs');
    $outcome = RaceConnections::second(fn () => DetectUnauthorizedPush::run($bot(), FakeGitHub::push('a41c9e7'.str_repeat('0', 33))));

    expect($outcome instanceof Throwable ? $outcome->getMessage() : $outcome)->toBe('foreign')
        ->and(AgentRun::query()->find($run->id)?->status)->toBe(RunStatus::Succeeded)
        ->and([AgentThread::query()->find($thread->id)?->status, AgentThread::query()->find($thread->id)?->session_id])->toBe([AgentThread::PAUSED, 'session-1'])
        ->and(array_column(ProjectRepository::query()->find($link->id)?->guard_runs ?? [], 'run_id'))->toBe([$run->id]);
});
