<?php

use App\Actions\Agents\StartTask;
use App\Models\AgentThread;
use App\Models\Project;
use App\Models\User;
use App\Models\Workflow;
use App\Models\WorkItem;
use App\Support\Actor;
use Tests\Support\AgentWorld;
use Tests\Support\FakeGitHub;
use Tests\Support\RaceConnections;

/*
 * WEBU-71: two children of an epic that start at once make one strand at the epic: the second waits at the row of the
 * epic and finds the strand the first made.
 */

beforeEach(fn () => RaceConnections::setUp());

afterEach(fn () => RaceConnections::tearDown());

it('makes one epic strand when two of its children start at once', function () {
    FakeGitHub::connected();
    $project = Project::factory()->create();
    FakeGitHub::link($project);
    $workflow = Workflow::default();
    $states = $workflow->states->pluck('id', 'name');
    $workflow->forceFill(['agent_states' => [
        'working' => $states['In Progress'], 'review' => $states['Pending'], 'correction' => $states['Todo'], 'merged' => $states['Done'],
    ]])->save();
    $agent = AgentWorld::agent([$project]);
    $epic = WorkItem::factory()->for($project)->epic()->create(['state_id' => $states['Todo']]);
    [$form, $map] = WorkItem::factory()->for($project)->childOf($epic)->count(2)->create(['state_id' => $states['Todo'], 'assignee_id' => $agent->id]);
    $start = fn (WorkItem $child) => fn () => StartTask::run(Actor::system(User::defaultBot(), 'test'), $child, $agent);

    RaceConnections::hold($start($form));
    RaceConnections::expectLockWait(RaceConnections::second($start($map)), 'work_items');
    RaceConnections::release();
    RaceConnections::second($start($map));

    $epicStrand = AgentThread::query()->where('work_item_id', $epic->id)->sole();
    expect(AgentThread::query()->where('parent_thread_id', $epicStrand->id)->pluck('work_item_id')->sort()->values()->all())
        ->toBe(collect([$form->id, $map->id])->sort()->values()->all());
});
