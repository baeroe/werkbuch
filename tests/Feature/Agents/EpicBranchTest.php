<?php

use App\Actions\Agents\AdvanceEpic;
use App\Actions\Agents\EnsureEpicBranch;
use App\Actions\WorkItems\UpdateWorkItem;
use App\Agents\AgentConsumer;
use App\Domain\Agents\RunStatus;
use App\GitHub\GitHubUnavailable;
use App\Models\AgentRun;
use App\Models\AgentThread;
use App\Models\Project;
use App\Models\User;
use App\Models\Workflow;
use App\Models\WorkItem;
use App\Support\Actor;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Exceptions;
use Tests\Support\AgentWorld;
use Tests\Support\FakeGitHub;

/*
 * WEBU-71, the edges of an epic on its own branch: what AdvanceEpic leaves alone, how its PR fails, how the branch of the
 * epic is made, and a bot that takes over an epic strand while a child of it is at work.
 */

beforeEach(function () {
    consumers(AgentConsumer::class);
    $this->github = FakeGitHub::connected();
    $this->project = Project::factory()->create(['identifier' => 'WEBU']);
    FakeGitHub::link($this->project);
    $workflow = Workflow::default();
    $this->states = $workflow->states->pluck('id', 'name');
    $workflow->forceFill(['agent_states' => [
        'working' => $this->states['In Progress'], 'review' => $this->states['Pending'], 'correction' => $this->states['Todo'], 'merged' => $this->states['Done'],
    ]])->save();
    $this->kira = AgentWorld::agent([$this->project]);
    $this->mara = User::factory()->admin()->create(['name' => 'Mara']);
    $this->system = Actor::system(User::defaultBot(), 'test');
    $this->epic = WorkItem::factory()->for($this->project)->epic()->create(['title' => 'Contact page', 'state_id' => $this->states['Todo']]);
    $this->strand = fn (array $more = []) => AgentThread::factory()->create(['bot_id' => $this->kira->id, 'work_item_id' => $this->epic->id,
        'repository_github_id' => 700_000_001, 'branch' => 'agent/epic', 'base_branch' => 'main', 'per_child' => true, ...$more]);
});

it('leaves a strand alone that is no open epic strand, also when it ends while it waits for the lock', function () {
    expect(AdvanceEpic::run($this->system, 'nope'))->toBe('stale')
        ->and(AdvanceEpic::run($this->system, ($this->strand)(['per_child' => false])->id))->toBe('stale');

    $strand = ($this->strand)();
    $done = false;
    DB::connection()->beforeExecuting(function (string $sql) use (&$done, $strand) {
        if (! $done && str_contains($sql, 'from `agent_threads`') && str_contains($sql, 'for update')) {
            $done = true;
            AgentThread::query()->whereKey($strand->id)->update(['status' => AgentThread::PAUSED]);
        }
    });
    expect(AdvanceEpic::run($this->system, $strand->id))->toBe('stale');
});

it('waits while a child strand is open', function () {
    $strand = ($this->strand)();
    $child = WorkItem::factory()->for($this->project)->childOf($this->epic)->create(['state_id' => $this->states['Todo']]);
    AgentThread::factory()->create(['bot_id' => $this->kira->id, 'work_item_id' => $child->id, 'parent_thread_id' => $strand->id]);

    expect(AdvanceEpic::run($this->system, $strand->id))->toBe('working');
});

it('opens no epic PR without a repo link and retries a PR GitHub refused', function () {
    $child = WorkItem::factory()->for($this->project)->childOf($this->epic)->create(['state_id' => $this->states['Done']]);
    $strand = ($this->strand)();
    AgentThread::factory()->create(['bot_id' => $this->kira->id, 'work_item_id' => $child->id, 'parent_thread_id' => $strand->id, 'status' => AgentThread::MERGED]);
    Exceptions::fake();

    // GitHub says there is no difference yet (422): silent; a 500 is reported; either way no PR, and the sweep tries again
    $this->github->refuse = ['/repos/*/*/pulls' => 422];
    AdvanceEpic::run($this->system, $strand->id);
    Exceptions::assertNothingReported();
    $strand->forceFill(['status' => AgentThread::OPEN, 'ready_requested_at' => null])->save();
    $this->github->refuse = ['/repos/*/*/pulls' => 500];
    AdvanceEpic::run($this->system, $strand->id);
    Exceptions::assertReported(RuntimeException::class);
    expect($strand->fresh()->pr_number)->toBeNull();

    // the repo unlinked: nothing to open
    $strand->forceFill(['status' => AgentThread::OPEN, 'ready_requested_at' => null])->save();
    $this->project->repository()->delete();
    $this->github->refuse = [];
    AdvanceEpic::run($this->system, $strand->id);
    expect($this->github->openedPulls)->toBe([]);
});

it('makes the branch of an epic once, from its base, and gives up without a base', function () {
    $strand = ($this->strand)();
    $child = AgentThread::factory()->create(['bot_id' => $this->kira->id, 'parent_thread_id' => $strand->id]);

    expect(EnsureEpicBranch::run($this->system, AgentThread::factory()->create(['bot_id' => $this->kira->id])))->toBe('none')
        ->and(EnsureEpicBranch::run($this->system, $child))->toBe('made')
        ->and(EnsureEpicBranch::run($this->system, $child))->toBe('there')
        ->and($this->github->createdBranches)->toBe([['branch' => 'agent/epic', 'sha' => $this->github->branches['main']]]);

    // made meanwhile by another claim (422): fine; any other refusal goes to the claim
    unset($this->github->branches['agent/epic']);
    $this->github->refuse = ['/repos/*/*/git/refs' => 422];
    expect(EnsureEpicBranch::run($this->system, $child))->toBe('made');
    $this->github->refuse = ['/repos/*/*/git/refs' => 403];
    expect(fn () => EnsureEpicBranch::run($this->system, $child))->toThrow(GitHubUnavailable::class);
    $this->github->refuse = ['/repos/*/*/git/ref/heads/*' => 500];
    expect(fn () => EnsureEpicBranch::run($this->system, $child))->toThrow(GitHubUnavailable::class);

    $this->github->refuse = [];
    unset($this->github->branches['main']);
    expect(fn () => EnsureEpicBranch::run($this->system, $child))->toThrow(GitHubUnavailable::class, 'no base branch main');
});

it('gives an epic strand to the bot the epic is assigned to, and starts no second child while one is at work', function () {
    $rita = AgentWorld::agent([$this->project], [], 'Rita');
    $form = WorkItem::factory()->for($this->project)->childOf($this->epic)->create(['state_id' => $this->states['Todo']]);
    WorkItem::factory()->for($this->project)->childOf($this->epic)->create(['state_id' => $this->states['Todo']]);

    // a child assigned alone: its strand is at work on the branch of the epic
    UpdateWorkItem::run(actor($this->mara), $form, ['assignee_id' => $rita->id]);
    $strand = AgentThread::query()->where('work_item_id', $this->epic->id)->sole();
    expect($strand->bot_id)->toBe($rita->id);

    UpdateWorkItem::run(actor($this->mara), $this->epic->fresh(), ['assignee_id' => $this->kira->id]);
    expect($strand->fresh()->bot_id)->toBe($this->kira->id)->and(AgentRun::query()->count())->toBe(1);
});

it('stops what a strand of its own of a child still had when the child goes on the branch of its epic', function () {
    $child = WorkItem::factory()->for($this->project)->childOf($this->epic)->create(['state_id' => $this->states['Todo']]);
    $old = AgentThread::factory()->create(['bot_id' => $this->kira->id, 'work_item_id' => $child->id, 'branch' => 'agent/old']);
    $run = AgentWorld::run($this->kira, $child, attributes: ['thread_id' => $old->id, 'status' => RunStatus::Queued]);

    UpdateWorkItem::run(actor($this->mara), $child, ['assignee_id' => $this->kira->id]);

    expect($old->fresh()->status)->toBe(AgentThread::CLOSED)->and($run->fresh()->status)->toBe(RunStatus::Canceled)
        ->and(AgentRun::query()->whereKeyNot($run->id)->sole()->thread->parent_thread_id)->not->toBeNull();
});
