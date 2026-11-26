<?php

use App\Actions\Agents\HandleRunResult;
use App\Actions\Agents\StartTask;
use App\Actions\WorkItems\UpdateWorkItem;
use App\Agents\AgentConsumer;
use App\Domain\Workflow\StateCategory;
use App\Domain\Workflow\StateIcon;
use App\Models\AgentRun;
use App\Models\AgentThread;
use App\Models\Project;
use App\Models\User;
use App\Models\Workflow;
use App\Models\WorkflowState;
use App\Models\WorkItem;
use App\Support\ItemAgentState;
use Tests\Support\AgentWorld;
use Tests\Support\FakeGitHub;

/*
 * WEBU-44: with the step `ready` (Todo) an agent begins an item only when it stands there (A772); Backlog waits.
 */

beforeEach(function () {
    consumers(AgentConsumer::class);
    FakeGitHub::connected();
    $this->project = Project::factory()->create(['identifier' => 'WEBU']);
    FakeGitHub::link($this->project);
    $workflow = Workflow::default();
    WorkflowState::query()->create(['workflow_id' => $workflow->id, 'name' => 'Reopened', 'icon' => StateIcon::Circle, 'category' => StateCategory::Unstarted, 'position' => 9]);
    $this->states = $workflow->fresh()->states->pluck('id', 'name');
    $workflow->forceFill(['agent_states' => [
        'working' => $this->states['In Progress'], 'review' => $this->states['Pending'], 'correction' => $this->states['Reopened'], 'merged' => $this->states['Done'],
        'ready' => $this->states['Todo'],
    ]])->save();
    $this->kira = AgentWorld::agent([$this->project]);
    $this->mara = User::factory()->admin()->create(['name' => 'Mara']);
});

$move = fn ($test, WorkItem $item, string $state) => UpdateWorkItem::run(actor($test->mara), $item, ['state_id' => $test->states[$state]]);

it('starts nothing when an item in the backlog is assigned, and says why', function () {
    $item = WorkItem::factory()->for($this->project)->create(['state_id' => $this->states['Backlog']]);

    UpdateWorkItem::run(actor($this->mara), $item, ['assignee_id' => $this->kira->id]);

    expect(AgentRun::query()->count())->toBe(0)
        ->and(ItemAgentState::of($item->fresh())['ready_state'])->toBe('Todo');
});

it('starts the task when a person moves the item to Todo, and when it is assigned there', function () use ($move) {
    $item = WorkItem::factory()->for($this->project)->create(['state_id' => $this->states['Backlog']]);
    UpdateWorkItem::run(actor($this->mara), $item, ['assignee_id' => $this->kira->id]);
    $move($this, $item, 'Todo');

    $other = WorkItem::factory()->for($this->project)->create(['state_id' => $this->states['Todo']]);
    UpdateWorkItem::run(actor($this->mara), $other, ['assignee_id' => $this->kira->id]);

    expect(AgentRun::query()->where('work_item_id', $item->id)->count())->toBe(1)
        ->and(AgentRun::query()->where('work_item_id', $other->id)->count())->toBe(1)
        ->and(ItemAgentState::of($item->fresh())['ready_state'])->toBeNull();
});

it('works only the children of an epic that stand in Todo and takes up one that gets there later', function () use ($move) {
    $epic = WorkItem::factory()->for($this->project)->epic()->create(['state_id' => $this->states['Todo']]);
    $todo = WorkItem::factory()->for($this->project)->childOf($epic)->create(['state_id' => $this->states['Todo']]);
    $later = WorkItem::factory()->for($this->project)->childOf($epic)->create(['state_id' => $this->states['Backlog']]);

    UpdateWorkItem::run(actor($this->mara), $epic, ['assignee_id' => $this->kira->id]);
    $thread = AgentThread::query()->sole();

    expect(AgentRun::query()->sole()->work_item_id)->toBe($todo->id)
        ->and(StartTask::nextChild($thread, $epic, $this->kira)?->id)->toBeNull()
        ->and(StartTask::waitsForReady($thread, $epic->fresh(), $this->kira))->toBeTrue();

    // the first task ends: the epic is not ready while a child waits in the backlog
    AgentRun::query()->update(['status' => 'succeeded']);
    expect(HandleRunResult::continueEpic(actor($this->mara), $thread))->toBe('waiting_ready');
    $move($this, $later, 'Todo');

    expect(AgentRun::query()->where('work_item_id', $later->id)->count())->toBe(1);
});

it('begins like before without the step ready', function () {
    Workflow::default()->forceFill(['agent_states' => [...Workflow::default()->agentStates(), 'ready' => null]])->save();
    $item = WorkItem::factory()->for($this->project)->create(['state_id' => $this->states['Backlog']]);

    UpdateWorkItem::run(actor($this->mara), $item, ['assignee_id' => $this->kira->id]);

    expect(AgentRun::query()->count())->toBe(1)->and(ItemAgentState::of($item->fresh())['ready_state'])->toBeNull();
});

it('begins an item of the bot that stands in Reopened without a strand like one from Todo', function () use ($move) {
    $item = WorkItem::factory()->for($this->project)->create(['state_id' => $this->states['Reopened']]);
    UpdateWorkItem::run(actor($this->mara), $item, ['assignee_id' => $this->kira->id]);

    $moved = WorkItem::factory()->for($this->project)->create(['state_id' => $this->states['Backlog'], 'assignee_id' => $this->kira->id]);
    $move($this, $moved, 'Reopened');

    expect(AgentRun::query()->where('work_item_id', $item->id)->count())->toBe(1)
        ->and(AgentRun::query()->where('work_item_id', $moved->id)->count())->toBe(1);
});

it('corrects the strand with a PR when a person moves the item to Reopened, and starts no second task', function () use ($move) {
    $item = WorkItem::factory()->for($this->project)->create(['state_id' => $this->states['Todo']]);
    UpdateWorkItem::run(actor($this->mara), $item, ['assignee_id' => $this->kira->id]);
    $thread = AgentThread::query()->sole();
    $thread->forceFill(['pr_number' => 7])->save();
    AgentRun::query()->update(['status' => 'succeeded']);

    $move($this, $item, 'Reopened');

    expect(AgentRun::query()->where('type', 'task')->count())->toBe(1)
        ->and(AgentRun::query()->where('type', 'correction')->count())->toBe(1);
});

it('leaves an item with a running task and no PR alone when it is moved back to Todo', function () use ($move) {
    $item = WorkItem::factory()->for($this->project)->create(['state_id' => $this->states['Todo']]);
    UpdateWorkItem::run(actor($this->mara), $item, ['assignee_id' => $this->kira->id]);
    $move($this, $item, 'In Progress');
    $move($this, $item, 'Todo');

    expect(AgentRun::query()->count())->toBe(1);
});

it('takes up a child of an epic in Reopened and does not wait for a child that is started or somebody else\'s', function () {
    $epic = WorkItem::factory()->for($this->project)->epic()->create(['state_id' => $this->states['Todo']]);
    $reopened = WorkItem::factory()->for($this->project)->childOf($epic)->create(['state_id' => $this->states['Reopened']]);
    WorkItem::factory()->for($this->project)->childOf($epic)->create(['state_id' => $this->states['Backlog'], 'assignee_id' => $this->mara->id]);
    $started = WorkItem::factory()->for($this->project)->childOf($epic)->create(['state_id' => $this->states['In Progress']]);

    UpdateWorkItem::run(actor($this->mara), $epic, ['assignee_id' => $this->kira->id]);
    $thread = AgentThread::query()->sole();

    expect(AgentRun::query()->sole()->work_item_id)->toBe($reopened->id)
        ->and(StartTask::waitsForReady($thread, $epic->fresh(), $this->kira))->toBeFalse();
    expect($started->fresh()->state_id)->toBe($this->states['In Progress']);
});
