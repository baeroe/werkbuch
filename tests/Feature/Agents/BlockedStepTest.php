<?php

use App\Actions\Agents\HandleRunResult;
use App\Actions\Agents\ReadyEpic;
use App\Actions\WorkItems\UpdateWorkItem;
use App\Agents\AgentConsumer;
use App\Models\AgentRun;
use App\Models\AgentThread;
use App\Models\Comment;
use App\Models\Project;
use App\Models\User;
use App\Models\Workflow;
use App\Models\WorkItem;
use Tests\Support\AgentWorld;
use Tests\Support\FakeGitHub;

/*
 * WEBU-50: a task that ends with `Outcome: blocked` writes what it needs, the item goes to Pending and to the owner,
 * the strand pauses; at a child of an epic the next child goes on and the epic is not ready while a child waits.
 */

beforeEach(function () {
    consumers(AgentConsumer::class);
    FakeGitHub::connected();
    $this->project = Project::factory()->create(['identifier' => 'WEBU']);
    FakeGitHub::link($this->project);
    $workflow = Workflow::default();
    $this->states = $workflow->states->pluck('id', 'name');
    $workflow->forceFill(['agent_states' => [
        'working' => $this->states['In Progress'], 'review' => $this->states['Todo'], 'correction' => $this->states['Backlog'], 'merged' => $this->states['Done'],
        'blocked' => $this->states['Pending'],
    ]])->save();
    $this->kira = AgentWorld::agent([$this->project]);
    $this->kira->forceFill(['owner_id' => ($this->mara = User::factory()->admin()->create(['name' => 'Mara']))->id])->save();
});

$finishBlocked = function ($test, AgentRun $run) {
    $run->forceFill(['status' => 'succeeded', 'result' => ['outcome' => 'blocked', 'summary' => 'No access to the production database.']])->save();

    return HandleRunResult::run(actor($test->kira), $run);
};

it('comments, moves the item to Pending, gives it to the owner and pauses the strand', function () use ($finishBlocked) {
    $item = WorkItem::factory()->for($this->project)->create(['state_id' => $this->states['Todo']]);
    UpdateWorkItem::run(actor($this->mara), $item, ['assignee_id' => $this->kira->id]);
    $run = AgentRun::query()->sole();

    expect($finishBlocked($this, $run))->toBe('blocked');

    $comment = Comment::query()->where('work_item_id', $item->id)->latest('id')->first();
    expect($item->fresh()->only(['state_id', 'assignee_id']))->toBe(['state_id' => $this->states['Pending'], 'assignee_id' => $this->mara->id])
        ->and(AgentThread::query()->sole()->only(['status', 'pause_reason']))->toBe(['status' => 'paused', 'pause_reason' => 'needs_person'])
        ->and($comment->body_text)->toContain('No access to the production database.')->and($comment->run_id)->toBe($run->id)
        ->and(AgentRun::query()->count())->toBe(1);
});

it('goes on with the next child of an epic and does not make the epic ready while a child waits', function () use ($finishBlocked) {
    $epic = WorkItem::factory()->for($this->project)->epic()->create(['state_id' => $this->states['Todo']]);
    $first = WorkItem::factory()->for($this->project)->childOf($epic)->create(['state_id' => $this->states['Todo']]);
    $second = WorkItem::factory()->for($this->project)->childOf($epic)->create(['state_id' => $this->states['Todo']]);
    UpdateWorkItem::run(actor($this->mara), $epic, ['assignee_id' => $this->kira->id]);
    $thread = AgentThread::query()->sole();

    expect($finishBlocked($this, AgentRun::query()->sole()))->toBe('next_child');
    expect($first->fresh()->state_id)->toBe($this->states['Pending'])->and($thread->fresh()->status)->toBe(AgentThread::OPEN)
        ->and(AgentRun::query()->where('work_item_id', $second->id)->count())->toBe(1);

    // the second ends fine: the epic still waits for the blocked child
    AgentRun::query()->where('work_item_id', $second->id)->update(['status' => 'succeeded']);
    $second->forceFill(['state_id' => $this->states['Todo']])->save();
    expect(ReadyEpic::run(actor($this->mara), $thread))->toBe('waiting');
});
