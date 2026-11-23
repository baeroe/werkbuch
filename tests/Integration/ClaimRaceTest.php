<?php

use App\Actions\AgentRuns\ClaimRun;
use App\Domain\Agents\RunStatus;
use App\Models\AgentRun;
use App\Models\Project;
use App\Models\User;
use App\Support\Actor;
use Tests\Support\AgentWorld;
use Tests\Support\RaceConnections;

/*
 * Two runners claim at once (spec 6.3, Review Focus): the candidates come without a lock, the one a runner takes is
 * read again `for update`, so the second claim waits for the first and then finds the run taken.
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

    expect($outcome['run'])->toBeNull()
        ->and(AgentRun::query()->find($run->id)?->status)->toBe(RunStatus::Running)
        ->and(AgentRun::query()->find($run->id)?->runner_id)->toBe($first->id);
});
