<?php

use App\Actions\AgentRuns\ClaimRun;
use App\Actions\AgentRuns\EnqueueRun;
use App\Domain\Agents\RunStatus;
use App\Models\AgentRun;
use App\Models\AgentThread;
use App\Models\Project;
use App\Models\User;
use App\Models\WorkItem;
use App\Support\Actor;
use Tests\Support\AgentWorld;
use Tests\Support\RaceConnections;

/*
 * Two runners claim at once (spec 6.3, Review Focus): the candidates come without a lock, the one a runner takes is
 * read again `for update`, so the second claim waits for the first and then finds the run taken; two runs of one strand
 * meet at the lock of the strand (A488).
 */

beforeEach(fn () => RaceConnections::setUp());

afterEach(fn () => RaceConnections::tearDown());

it('hands a run to exactly one of two runners claiming at once', function () {
    $project = Project::factory()->create();
    $agent = AgentWorld::agent([$project]);
    $run = AgentWorld::run($agent, $project);
    [$first] = AgentWorld::runner();
    [$second] = AgentWorld::runner();
    $system = fn () => Actor::system(User::defaultBot(), 'test');

    // the first claim takes the run and holds its transaction open ...
    $taken = RaceConnections::hold(fn () => ClaimRun::run($system(), $first, ['protocol' => '1']));
    expect($taken['run']['id'])->toBe($run->id);

    // ... the second reads the same candidate and waits for its row; the first commits right then
    RaceConnections::releaseBeforeLock('agent_runs');
    $outcome = RaceConnections::second(fn () => ClaimRun::run($system(), $second, ['protocol' => '1']));

    expect($outcome instanceof Throwable ? $outcome->getMessage() : null)->toBeNull();
    expect($outcome['run'])->toBeNull()
        ->and(AgentRun::query()->find($run->id)?->status)->toBe(RunStatus::Running)
        ->and(AgentRun::query()->find($run->id)?->runner_id)->toBe($first->id);
});

it('starts only one run of a strand when two runners take two of its runs at once (A488)', function () {
    $project = Project::factory()->create();
    $agent = AgentWorld::agent([$project]);
    $item = WorkItem::factory()->create(['project_id' => $project->id]);
    $thread = AgentThread::factory()->create(['bot_id' => $agent->id, 'work_item_id' => $item->id, 'project_id' => $project->id]);
    $system = fn () => Actor::system(User::defaultBot(), 'test');
    $correction = EnqueueRun::run($system(), $agent, $project, $item, 'correction', $thread);
    $comment = EnqueueRun::run($system(), $agent, $project, $item, 'comment', $thread);
    // the first runner has only a light place: it takes the comment
    [$first] = AgentWorld::runner(['slots_total' => 0, 'slots_per_repo' => 0, 'slots_light' => 1]);
    [$second] = AgentWorld::runner();

    // the first claim takes the comment and holds the strand ...
    $taken = RaceConnections::hold(fn () => ClaimRun::run($system(), $first, ['protocol' => '1']));
    expect($taken['run']['id'])->toBe($comment->id);

    // ... the second still sees the strand free, takes the correction, waits for the strand and then leaves it
    RaceConnections::releaseBeforeLock('agent_threads');
    $outcome = RaceConnections::second(fn () => ClaimRun::run($system(), $second, ['protocol' => '1']));

    expect($outcome)->toBeArray()
        ->and($outcome['run'])->toBeNull()
        ->and(AgentRun::query()->find($correction->id)?->status->pending())->toBeTrue()
        ->and(AgentRun::query()->where('thread_id', $thread->id)->where('status', RunStatus::Running->value)->pluck('id')->all())->toBe([$comment->id])
        ->and(AgentThread::query()->find($thread->id)?->runner_id)->toBe($first->id);
});
