<?php

use App\Actions\Agents\PauseThread;
use App\Domain\Agents\RunStatus;
use App\Domain\Agents\RunType;
use App\Models\AgentRun;
use App\Models\AgentThread;
use App\Models\Project;
use App\Models\User;
use App\Models\WorkItem;
use App\Support\Actor;
use Illuminate\Support\Facades\DB;
use Tests\Support\AgentWorld;
use Tests\Support\RaceConnections;

/*
 * The locks of the flow and of the runner cross at a strand (A592): the flow takes item → runs → strand, the claim and
 * the end of a run take run → strand. A run the flow holds keeps the other side waiting at the run, never at the strand
 * it would hold already: no deadlock, and the other side sees what the flow decided.
 */

beforeEach(fn () => RaceConnections::setUp());

afterEach(fn () => RaceConnections::tearDown());

it('keeps the runner waiting at the run while the flow holds a strand, and lets it see the run canceled', function () {
    $project = Project::factory()->create();
    $agent = AgentWorld::agent([$project]);
    $item = WorkItem::factory()->create(['project_id' => $project->id, 'assignee_id' => $agent->id]);
    $thread = AgentThread::factory()->create(['bot_id' => $agent->id, 'project_id' => $project->id, 'work_item_id' => $item->id]);
    $run = AgentRun::factory()->type(RunType::Task)->create(['bot_id' => $agent->id, 'project_id' => $project->id, 'work_item_id' => $item->id, 'thread_id' => $thread->id, 'status' => RunStatus::Queued]);
    $bot = fn () => Actor::system(User::defaultBot(), 'test');

    // as the claim and FinishRun take them: the run, then the strand
    $runner = fn () => DB::transaction(fn () => [
        AgentRun::query()->lockForUpdate()->findOrFail($run->id)->status,
        AgentThread::query()->lockForUpdate()->findOrFail($thread->id)->status,
    ]);

    // the flow pauses the strand and holds its locks ...
    RaceConnections::hold(fn () => PauseThread::run($bot(), $thread, 'reassigned'));

    // ... the runner waits at the run, not at the strand
    RaceConnections::expectLockWait(RaceConnections::second($runner), 'agent_runs');

    // once the flow commits, the runner sees the run canceled and the strand paused
    RaceConnections::releaseBeforeLock('agent_runs');
    expect(RaceConnections::second($runner))->toBe([RunStatus::Canceled, AgentThread::PAUSED]);
});
