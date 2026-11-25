<?php

use App\Access\ProjectRole;
use App\Access\RoleAssignments;
use App\Actions\Agents\ResumeThread;
use App\Actions\Comments\AddComment;
use App\Actions\GitHub\DisconnectGitHub;
use App\Domain\Agents\RunStatus;
use App\Domain\Agents\RunType;
use App\Events\EventType;
use App\Exceptions\Problem;
use App\Models\AgentConfig;
use App\Models\AgentRun;
use App\Models\AgentThread;
use App\Models\GitHubRepository;
use App\Models\Project;
use App\Models\User;
use App\Models\Workflow;
use App\Models\WorkItem;
use Tests\Support\AgentWorld;
use Tests\Support\FakeGitHub;
use Tests\Support\Mcp\McpClient;

/*
 * „Weitermachen“ (WEBU-28, A642): a strand that waits since GitHub was disconnected goes on with a correction once the
 * project has its repo again; the brakes keep counting.
 */

beforeEach(function () {
    $this->mara = User::factory()->create(['name' => 'Mara']);
    $this->project = Project::factory()->identifier('WEB')->member($this->mara, ProjectRole::Member)->create();
    $workflow = Workflow::default();
    $this->states = $workflow->states->pluck('id', 'name');
    $workflow->forceFill(['agent_states' => [
        'working' => $this->states['In Progress'], 'review' => $this->states['Pending'], 'correction' => $this->states['Todo'], 'merged' => $this->states['Done'],
    ]])->save();
    $this->kira = AgentWorld::agent([$this->project]);
    FakeGitHub::connected();
    $this->link = FakeGitHub::link($this->project);
    $this->item = WorkItem::factory()->for($this->project)->create(['state_id' => $this->states['Pending'], 'assignee_id' => $this->kira->id]);
});

/** The strand of Kira at the item, paused as GitHub left it unless the attributes say otherwise. */
$strand = fn (array $attributes = []) => AgentThread::factory()->create([
    'bot_id' => test()->kira->id, 'work_item_id' => test()->item->id, 'status' => AgentThread::PAUSED, 'pause_reason' => DisconnectGitHub::REASON,
    'repository_github_id' => 700_000_001, 'branch' => 'agent/WEB-1-form', 'pr_number' => 24, ...$attributes,
]);

/** The refusal of resuming the item as Mara: its status, reason and detail. */
$refusal = function (): array {
    try {
        ResumeThread::run(actor(test()->mara), test()->item);
    } catch (Problem $e) {
        return [$e->getStatusCode(), $e->reason, $e->detail];
    }

    throw new RuntimeException('Resumed.');
};

it('resumes the strand with a correction of what people wrote since its last run', function () use ($strand) {
    $thread = $strand(['corrections' => 1]);
    AgentWorld::run($this->kira, $this->item, RunType::Task, ['thread_id' => $thread->id, 'status' => RunStatus::Canceled, 'finished_at' => now()->subHour()]);
    AddComment::run(actor($this->mara), $this->item, ['body' => 'The form needs a second field.']);

    $resumed = ResumeThread::run(actor($this->mara), $this->item);

    $thread->refresh();
    expect($resumed['braked'])->toBeFalse()
        ->and($resumed['run'])->toBeInstanceOf(AgentRun::class)
        ->and($resumed['run']->type)->toBe(RunType::Correction)
        ->and($resumed['run']->thread_id)->toBe($thread->id)
        ->and($resumed['run']->context['source'])->toBe('comments')
        ->and($resumed['run']->context['findings'])->toContain('GitHub is connected again')->toContain('Mara: The form needs a second field.')
        ->and($thread->status)->toBe(AgentThread::OPEN)
        ->and($thread->pause_reason)->toBeNull()
        // the brakes keep counting
        ->and($thread->corrections)->toBe(2)
        ->and($this->item->fresh()->state_id)->toBe($this->states['Todo'])
        ->and(eventsOf(EventType::AgentRunQueued, $resumed['run'])->sole()->actor_id)->toBe($this->mara->id);
});

it('pauses the strand again at its brake', function () use ($strand) {
    $thread = $strand(['corrections' => 3]);

    $resumed = ResumeThread::run(actor($this->mara), $this->item);

    expect($resumed)->toBe(['run' => null, 'braked' => true])
        ->and($thread->fresh()->only(['status', 'pause_reason', 'corrections']))->toBe(['status' => AgentThread::PAUSED, 'pause_reason' => 'brake', 'corrections' => 3])
        ->and(AgentRun::query()->where('thread_id', $thread->id)->exists())->toBeFalse();
});

it('resumes only a strand that waits for GitHub, of the bot the item is assigned to', function () use ($strand, $refusal) {
    expect($refusal())->toBe([409, 'thread_not_resumable', __('problem.detail.resume_not_paused')]);

    $thread = $strand(['pause_reason' => 'brake']);
    expect($refusal())->toBe([409, 'thread_not_resumable', __('problem.detail.resume_not_paused')]);

    $thread->forceFill(['status' => AgentThread::OPEN, 'pause_reason' => null])->save();
    expect($refusal())->toBe([409, 'thread_not_resumable', __('problem.detail.resume_not_paused')]);

    $thread->forceFill(['status' => AgentThread::PAUSED, 'pause_reason' => DisconnectGitHub::REASON])->save();
    $this->item->forceFill(['assignee_id' => $this->mara->id])->save();
    expect($refusal())->toBe([409, 'thread_not_resumable', __('problem.detail.resume_reassigned')])
        ->and($thread->fresh()->status)->toBe(AgentThread::PAUSED);
});

it('resumes only once the project has the repo of the strand again, and no guard holds it', function () use ($strand, $refusal) {
    $thread = $strand();
    $this->link->delete();
    expect($refusal())->toBe([409, 'no_repository', __('problem.detail.resume_no_repository')]);

    $other = GitHubRepository::factory()->create(['installation_id' => GitHubRepository::query()->firstOrFail()->installation_id, 'github_id' => 700_000_009, 'full_name' => 'feldwerk/other']);
    $link = FakeGitHub::link($this->project, $other->full_name);
    expect($refusal())->toBe([409, 'no_repository', __('problem.detail.resume_no_repository')]);

    // a strand that started without a repo takes the repo the project has now
    $thread->forceFill(['repository_github_id' => null])->save();
    $link->forceFill(['guard_detected_at' => now(), 'guard_sha' => str_repeat('a', 40), 'guard_branch' => 'main'])->save();
    expect($refusal())->toBe([409, 'merge_guard_open', null]);

    $link->forceFill(['guard_detected_at' => null])->save();
    expect(ResumeThread::run(actor($this->mara), $this->item)['run'])->not->toBeNull();
});

it('resumes nothing in an archived project or at an archived item', function () use ($strand, $refusal) {
    $thread = $strand();
    $this->project->forceFill(['archived_at' => now()])->save();
    expect($refusal())->toBe([409, 'project_archived', __('problem.detail.project_archived')]);

    $this->project->forceFill(['archived_at' => null])->save();
    $this->item->forceFill(['archived_at' => now()])->save();
    expect($refusal())->toBe([409, 'archived', __('problem.detail.item_archived', ['key' => $this->item->key])])
        ->and($thread->fresh()->only(['status', 'pause_reason']))->toBe(['status' => AgentThread::PAUSED, 'pause_reason' => DisconnectGitHub::REASON]);
});

it('says why its bot works here as an agent no more, and leaves the strand waiting (A647)', function (string $code, Closure $break) use ($strand, $refusal) {
    $thread = $strand();
    $break->call($this);
    $bot = User::query()->findOrFail($thread->fresh()->bot_id);

    expect($refusal())->toBe([409, $code, __('items.agents.refusal.'.$code, ['bot' => $bot->name, 'project' => $this->project->name])])
        ->and($thread->fresh()->only(['status', 'pause_reason']))->toBe(['status' => AgentThread::PAUSED, 'pause_reason' => DisconnectGitHub::REASON])
        ->and(AgentRun::query()->where('thread_id', $thread->id)->exists())->toBeFalse();
})->with([
    'switched off' => ['agent_off', function () {
        AgentConfig::query()->where('bot_id', $this->kira->id)->update(['enabled' => false]);
    }],
    'the default bot' => ['default_bot', function () {
        $default = User::defaultBot();
        AgentConfig::factory()->create(['bot_id' => $default->id]);
        AgentThread::query()->update(['bot_id' => $default->id]);
        $this->item->forceFill(['assignee_id' => $default->id])->save();
    }],
    'deactivated' => ['disabled', function () {
        $this->kira->forceFill(['disabled_at' => now()])->save();
    }],
    'without a responsible person' => ['no_owner', function () {
        $this->kira->forceFill(['owner_id' => null])->save();
    }],
    'a workflow without the steps' => ['no_steps', function () {
        Workflow::default()->forceFill(['agent_states' => null])->save();
    }],
    'no member' => ['not_member', function () {
        app(RoleAssignments::class)->removeFromProject($this->kira, $this->project);
    }],
]);

it('answers the queued run over REST, and 409 as a problem', function () use ($strand) {
    $strand();

    $this->actingAs($this->mara)->postJson("/api/v1/work-items/{$this->item->key}/agent/resume")->assertOk()
        ->assertJsonPath('data.braked', false)
        ->assertJsonPath('data.run.type', 'correction')
        ->assertJsonPath('data.run.work_item_id', $this->item->id);

    $this->postJson("/api/v1/work-items/{$this->item->key}/agent/resume")->assertConflict()
        ->assertJsonPath('reason', 'thread_not_resumable');
});

it('answers a strand at its brake over REST', function () use ($strand) {
    $strand(['corrections' => 3]);

    $this->actingAs($this->mara)->postJson("/api/v1/work-items/{$this->item->key}/agent/resume")->assertOk()
        ->assertExactJson(['data' => ['run' => null, 'braked' => true]]);
});

it('answers a strand at its brake over MCP as REST does', function () use ($strand) {
    $strand(['corrections' => 3]);

    $answer = McpClient::for($this, apiToken($this->mara, ['read', 'write', 'mcp']))->call('manage-agents', ['action' => 'resume-thread', 'item' => $this->item->key]);

    expect($answer['structuredContent'])->toBe(['data' => ['run' => null, 'braked' => true]]);
});
