<?php

use App\Actions\Agents\ApproveAndMerge;
use App\Jobs\MergeAgentPullRequest;
use App\Models\AgentThread;
use App\Models\Project;
use App\Models\User;
use App\Models\WorkItem;
use App\Models\WorkItemLink;
use App\Models\WorkItemLinkCheck;
use App\Support\Actor;
use Illuminate\Support\Facades\Queue;
use Tests\Support\AgentWorld;
use Tests\Support\RaceConnections;

/*
 * The merge of a strand is decided once per head commit (spec 7.2): the end of the review and the last green check
 * may decide at the same time; the second waits for the lock of the strand and finds the merge decided.
 */

beforeEach(fn () => RaceConnections::setUp());

afterEach(fn () => RaceConnections::tearDown());

it('merges a thread once when two decide at the same time', function () {
    Queue::fake([MergeAgentPullRequest::class]);
    $project = Project::factory()->create();
    $agent = AgentWorld::agent([$project]);
    $item = WorkItem::factory()->create(['project_id' => $project->id]);
    $sha = str_repeat('b', 40);
    $thread = AgentThread::factory()->create(['bot_id' => $agent->id, 'project_id' => $project->id, 'work_item_id' => $item->id, 'repository_github_id' => 700_000_001,
        'pr_number' => 12, 'head_sha' => $sha, 'review_sha' => $sha, 'review_verdict' => 'approve']);
    $link = WorkItemLink::factory()->create(['work_item_id' => $item->id, 'number' => 12, 'head_sha' => $sha, 'thread_id' => $thread->id]);
    WorkItemLinkCheck::query()->create(['work_item_link_id' => $link->id, 'check_run_id' => 1, 'name' => 'tests', 'status' => 'completed', 'conclusion' => 'success', 'head_sha' => $sha]);
    $bot = fn () => Actor::system(User::defaultBot(), 'test');

    // the review decides and holds its transaction open ...
    RaceConnections::hold(fn () => ApproveAndMerge::run($bot(), $thread));

    // ... the last check decides too: it waits for the strand, then finds the merge of this commit decided
    RaceConnections::releaseBeforeLock('agent_threads');
    $second = RaceConnections::second(fn () => ApproveAndMerge::run($bot(), $thread));

    expect($second)->toBeFalse()
        ->and(AgentThread::query()->find($thread->id)?->merge_sha)->toBe($sha);
    Queue::assertPushed(MergeAgentPullRequest::class, 1);
});
