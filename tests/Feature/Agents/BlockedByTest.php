<?php

use App\Actions\WorkItems\RemoveRelation;
use App\Actions\WorkItems\UpdateWorkItem;
use App\Agents\AgentConsumer;
use App\Domain\Workflow\StateCategory;
use App\Models\AgentRun;
use App\Models\AgentThread;
use App\Models\Project;
use App\Models\User;
use App\Models\Workflow;
use App\Models\WorkItem;
use App\Models\WorkItemRelation;
use App\Support\ItemAgentState;
use Tests\Support\AgentWorld;
use Tests\Support\FakeGitHub;

/*
 * WEBU-51: an item that an open item blocks is not begun; it begins when the last blocker is Completed or Canceled
 * or the relation goes.
 */

beforeEach(function () {
    consumers(AgentConsumer::class);
    FakeGitHub::connected();
    $this->project = Project::factory()->create(['identifier' => 'WEBU']);
    FakeGitHub::link($this->project);
    $states = Workflow::default()->states->pluck('id', 'name');
    Workflow::default()->forceFill(['agent_states' => [
        'working' => $states['In Progress'], 'review' => $states['Pending'], 'correction' => $states['Todo'], 'merged' => $states['Done'], 'ready' => null,
    ]])->save();
    $this->kira = AgentWorld::agent([$this->project]);
    $this->mara = User::factory()->admin()->create(['name' => 'Mara']);
    $this->blocker = WorkItem::factory()->for($this->project)->create();
    $this->item = WorkItem::factory()->for($this->project)->create();
    $this->relation = WorkItemRelation::factory()->blocks()->create(['source_id' => $this->blocker->id, 'target_id' => $this->item->id]);
});

it('starts nothing for a blocked item, says why and begins when the blocker is closed', function () {
    UpdateWorkItem::run(actor($this->mara), $this->item, ['assignee_id' => $this->kira->id]);

    expect(AgentRun::query()->count())->toBe(0)
        ->and(ItemAgentState::of($this->item->fresh())['blocked_by'])->toBe([$this->blocker->key]);

    $done = Workflow::default()->states->first(fn ($s) => $s->category->isClosed());
    UpdateWorkItem::run(actor($this->mara), $this->blocker, ['state_id' => $done->id]);

    expect(AgentRun::query()->where('work_item_id', $this->item->id)->count())->toBe(1)
        ->and(ItemAgentState::of($this->item->fresh())['blocked_by'])->toBe([]);
});

it('begins when the relation is removed', function () {
    UpdateWorkItem::run(actor($this->mara), $this->item, ['assignee_id' => $this->kira->id]);
    RemoveRelation::run(actor($this->mara), $this->relation);

    expect(AgentRun::query()->where('work_item_id', $this->item->id)->count())->toBe(1);
});

it('skips a blocked child of an epic and takes the next one', function () {
    $epic = WorkItem::factory()->for($this->project)->epic()->create();
    $blocked = WorkItem::factory()->for($this->project)->childOf($epic)->create(['rank' => 'a0']);
    $free = WorkItem::factory()->for($this->project)->childOf($epic)->create(['rank' => 'a1']);
    WorkItemRelation::factory()->blocks()->create(['source_id' => $this->blocker->id, 'target_id' => $blocked->id]);

    UpdateWorkItem::run(actor($this->mara), $epic, ['assignee_id' => $this->kira->id]);

    expect(AgentRun::query()->sole()->work_item_id)->toBe($free->id);
});

it('pauses the strand of a blocker a person cancels, and still frees what it blocked', function () {
    UpdateWorkItem::run(actor($this->mara), $this->blocker, ['assignee_id' => $this->kira->id]);
    $thread = AgentThread::query()->sole();
    UpdateWorkItem::run(actor($this->mara), $this->item, ['assignee_id' => $this->kira->id]);
    expect(AgentRun::query()->where('work_item_id', $this->item->id)->count())->toBe(0);

    $canceled = Workflow::default()->states->first(fn ($s) => $s->category === StateCategory::Canceled);
    UpdateWorkItem::run(actor($this->mara), $this->blocker, ['state_id' => $canceled->id]);

    expect($thread->fresh()->status)->toBe(AgentThread::PAUSED)
        ->and(AgentRun::query()->where('work_item_id', $this->item->id)->count())->toBe(1);
});

it('starts nothing when a relation other than blocks is removed', function () {
    $relates = WorkItemRelation::factory()->create(['source_id' => $this->blocker->id, 'target_id' => $this->item->id]);
    UpdateWorkItem::run(actor($this->mara), $this->item, ['assignee_id' => $this->kira->id]);
    RemoveRelation::run(actor($this->mara), $relates);

    expect(AgentRun::query()->count())->toBe(0);
});
