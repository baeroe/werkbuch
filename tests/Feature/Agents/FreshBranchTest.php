<?php

use App\Models\AgentThread;
use App\Models\Project;
use App\Models\WorkItem;

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
