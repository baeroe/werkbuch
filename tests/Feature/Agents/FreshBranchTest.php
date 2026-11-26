<?php

use App\Actions\Agents\StartTask;
use App\Actions\WorkItems\UpdateWorkItem;
use App\Agents\AgentConsumer;
use App\Models\AgentThread;
use App\Models\Project;
use App\Models\User;
use App\Models\Workflow;
use App\Models\WorkItem;
use Tests\Support\AgentWorld;
use Tests\Support\FakeGitHub;

/* WEBU-52: a new strand of an item never takes the branch of an older one. */
it('gives a new strand of the item a branch no earlier strand has', function () {
    $item = WorkItem::factory()->for(Project::factory()->create())->create(['title' => 'Fix the login form']);
    $base = AgentThread::branchFor($item);

    expect(AgentThread::freshBranchFor($item))->toBe($base);

    AgentThread::factory()->create(['work_item_id' => $item->id, 'project_id' => $item->project_id, 'branch' => $base]);
    expect(AgentThread::freshBranchFor($item))->toBe($base.'-2');

    AgentThread::factory()->create(['work_item_id' => $item->id, 'project_id' => $item->project_id, 'branch' => $base.'-2']);
    expect(AgentThread::freshBranchFor($item))->toBe($base.'-3');
});

it('starts a second strand on the -2 branch after the first was closed', function () {
    consumers(AgentConsumer::class);
    Workflow::default()->forceFill(['agent_states' => [
        'working' => Workflow::default()->states->firstWhere('name', 'In Progress')->id,
        'review' => Workflow::default()->states->firstWhere('name', 'Pending')->id,
        'correction' => Workflow::default()->states->firstWhere('name', 'Backlog')->id,
        'merged' => Workflow::default()->states->firstWhere('name', 'Done')->id,
    ]])->save();
    FakeGitHub::connected();
    $project = Project::factory()->create();
    FakeGitHub::link($project);
    $bot = AgentWorld::agent([$project]);
    $mara = User::factory()->admin()->create();
    $item = WorkItem::factory()->for($project)->create(['title' => 'Fix the login form']);

    UpdateWorkItem::run(actor($mara), $item, ['assignee_id' => $bot->id]);
    $first = AgentThread::query()->sole();
    $first->forceFill(['status' => AgentThread::CLOSED])->save();
    StartTask::run(actor($mara), $item->fresh(), $bot);

    expect(AgentThread::query()->where('status', AgentThread::OPEN)->sole()->branch)->toBe($first->branch.'-2');
});
