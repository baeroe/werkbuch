<?php

use App\Access\ProjectRole;
use App\Access\RoleAssignments;
use App\Actions\AgentRuns\EnqueueRun;
use App\Actions\Agents\CheckThreadMergeability;
use App\Actions\Agents\CompleteThread;
use App\Actions\Agents\FollowEvent;
use App\Actions\Agents\HandleAgentPullRequest;
use App\Actions\Agents\HandleCheckResult;
use App\Actions\Agents\HandleRunResult;
use App\Actions\Agents\MarkThreadReady;
use App\Actions\Agents\MergeThread;
use App\Actions\Agents\PauseThread;
use App\Actions\Agents\PostReviewVerdict;
use App\Actions\Agents\ReadyEpic;
use App\Actions\Agents\StartComment;
use App\Actions\Agents\StartConflict;
use App\Actions\Agents\StartCorrection;
use App\Actions\Agents\StartReview;
use App\Actions\Agents\StartTask;
use App\Actions\Agents\SweepAgentThreads;
use App\Actions\Comments\AddComment;
use App\Actions\WorkItems\UpdateWorkItem;
use App\Agents\AgentConsumer;
use App\Domain\Agents\RunStatus;
use App\Domain\Agents\RunType;
use App\Domain\Workflow\AgentStep;
use App\Events\EventType;
use App\GitHub\GitHubApi;
use App\GitHub\GitHubUnavailable;
use App\Jobs\CheckPullRequestMergeability;
use App\Jobs\MarkPullRequestReady;
use App\Jobs\MergeAgentPullRequest;
use App\Jobs\PostReviewVerdict as PostReviewVerdictJob;
use App\Jobs\SweepAgentThreadsJob;
use App\Models\AgentConfig;
use App\Models\AgentProjectSettings;
use App\Models\AgentRun;
use App\Models\AgentThread;
use App\Models\Comment;
use App\Models\Event;
use App\Models\GitHubDelivery;
use App\Models\Label;
use App\Models\Project;
use App\Models\User;
use App\Models\Workflow;
use App\Models\WorkItem;
use App\Models\WorkItemLink;
use App\Models\WorkItemLinkCheck;
use App\Support\Actor;
use App\Support\AgentFlow;
use App\Support\RunPrompts;
use Illuminate\Console\Scheduling\Schedule;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Exceptions;
use Illuminate\Support\Facades\Http;
use Tests\Support\AgentWorld;
use Tests\Support\FakeGitHub;

/*
 * The edges of the flow of the agents (spec 7): what it does with what goes wrong, what it leaves alone, a project
 * without a repo, the jobs and their waiting, the rules of the prompts and the model.
 */

beforeEach(function () {
    $this->project = Project::factory()->create(['identifier' => 'WEBU']);
    $workflow = Workflow::default();
    $this->states = $workflow->states->pluck('id', 'name');
    $workflow->forceFill(['agent_states' => [
        'working' => $this->states['In Progress'], 'review' => $this->states['Pending'], 'correction' => $this->states['Todo'], 'merged' => $this->states['Done'],
    ]])->save();
    $this->kira = AgentWorld::agent([$this->project]);
    $this->system = Actor::system(User::defaultBot(), 'test');
});

/** A strand of Kira at a new item (or the item given) with these attributes. */
$strand = fn (array $attributes = [], ?WorkItem $item = null) => AgentThread::factory()->create([
    'bot_id' => test()->kira->id, 'project_id' => test()->project->id,
    'work_item_id' => ($item ?? WorkItem::factory()->for(test()->project)->create(['state_id' => test()->states['Todo'], 'assignee_id' => test()->kira->id]))->id,
    ...$attributes,
]);

/** A run of Kira that ended at a strand. */
$ended = fn (AgentThread $thread, RunType $type, RunStatus $status, array $attributes = []) => AgentRun::factory()->type($type)->create([
    'bot_id' => test()->kira->id, 'project_id' => test()->project->id, 'work_item_id' => $thread->work_item_id, 'thread_id' => $thread->id,
    'status' => $status, 'finished_at' => now(), ...$attributes,
]);

it('works an item of a project without a repo to „Gemergt“ with its summary as a comment', function () use ($ended) {
    consumers(AgentConsumer::class);
    $item = WorkItem::factory()->for($this->project)->create(['state_id' => $this->states['Todo']]);
    UpdateWorkItem::run(actor(User::factory()->admin()->create()), $item, ['assignee_id' => $this->kira->id]);
    $thread = AgentThread::query()->sole();
    expect($thread->repository_github_id)->toBeNull()
        ->and(RunPrompts::for(AgentRun::query()->sole())['prompt'])->toContain('This project has no repository');

    $run = AgentRun::query()->sole();
    $run->forceFill(['status' => RunStatus::Succeeded, 'finished_at' => now(), 'result' => ['summary' => 'Wrote the letter.']])->save();
    expect(HandleRunResult::run($this->system, $run))->toBe('done')
        ->and($item->fresh()->state_id)->toBe($this->states['Done'])
        ->and($thread->fresh()->status)->toBe(AgentThread::MERGED)
        ->and(Comment::query()->where('author_id', $this->kira->id)->sole()->body_text)->toBe('Wrote the letter.');

    // no summary: „Erledigt“
    $other = AgentThread::factory()->create(['bot_id' => $this->kira->id, 'project_id' => $this->project->id]);
    expect(HandleRunResult::run($this->system, $ended($other, RunType::Task, RunStatus::Succeeded)))->toBe('done')
        ->and(Comment::query()->where('work_item_id', $other->work_item_id)->sole()->body_text)->toBe(__('agents.comment.done'));
});

it('works the children of an epic without a repo one by one and then the epic', function () {
    $epic = WorkItem::factory()->for($this->project)->epic()->create(['state_id' => $this->states['Todo'], 'assignee_id' => $this->kira->id]);
    $child = WorkItem::factory()->for($this->project)->childOf($epic)->create(['state_id' => $this->states['Todo']]);
    $first = StartTask::run($this->system, $epic, $this->kira);
    expect($first->work_item_id)->toBe($child->id);

    $first->forceFill(['status' => RunStatus::Succeeded, 'finished_at' => now(), 'result' => ['summary' => 'Done.']])->save();
    expect(HandleRunResult::run($this->system, $first))->toBe('done')
        ->and([$child->fresh()->state_id, $epic->fresh()->state_id])->toBe([$this->states['Done'], $this->states['Done']]);

    // an epic without children is a task of its own
    $alone = WorkItem::factory()->for($this->project)->epic()->create(['assignee_id' => $this->kira->id]);
    expect(StartTask::run($this->system, $alone, $this->kira)->work_item_id)->toBe($alone->id);
});

it('says why a run failed and sets the item back, a light run only comments', function () use ($strand, $ended) {
    $thread = $strand();
    $item = WorkItem::query()->find($thread->work_item_id);

    expect(HandleRunResult::run($this->system, $ended($thread, RunType::Task, RunStatus::TimedOut)))->toBe('failed')
        ->and($item->fresh()->state_id)->toBe($this->states['Todo'])
        ->and(Comment::query()->latest('id')->first()->body_text)->toContain('timed_out');

    $item->forceFill(['state_id' => $this->states['Pending']])->save();
    expect(HandleRunResult::run($this->system, $ended($thread, RunType::Comment, RunStatus::Failed, ['error' => 'claude: not logged in'])))->toBe('failed')
        ->and($item->fresh()->state_id)->toBe($this->states['Pending'])
        ->and(Comment::query()->latest('id')->first()->body_text)->toContain('claude: not logged in');

    // without an item nothing to say; a comment without text answers that it has none; a canceled run is nothing
    expect(HandleRunResult::run($this->system, $ended($thread, RunType::Review, RunStatus::Failed, ['work_item_id' => null])))->toBe('nothing')
        ->and(HandleRunResult::run($this->system, $ended($thread, RunType::Comment, RunStatus::Succeeded)))->toBe('answered')
        ->and(Comment::query()->latest('id')->first()->body_text)->toBe(__('agents.comment.no_answer'))
        ->and(HandleRunResult::run($this->system, $ended($thread, RunType::Task, RunStatus::Running)))->toBe('nothing')
        ->and(HandleRunResult::run($this->system, $ended($thread, RunType::Task, RunStatus::Succeeded, ['thread_id' => null])))->toBe('nothing');
});

it('waits two minutes for the PR of a task, then says there is none', function () use ($strand, $ended) {
    $thread = $strand(['repository_github_id' => 700_000_001]);
    expect(HandleRunResult::run($this->system, $ended($thread, RunType::Task, RunStatus::Succeeded)))->toBe('awaiting_pr');

    expect(SweepAgentThreads::run($this->system))->toBe(0);
    $this->travel(3)->minutes();
    expect(SweepAgentThreads::run($this->system))->toBe(1)
        ->and(WorkItem::query()->find($thread->work_item_id)->state_id)->toBe($this->states['Todo'])
        ->and($thread->fresh()->awaiting_pr_since)->toBeNull()
        ->and(Comment::query()->sole()->body_text)->toBe(__('agents.comment.no_pr'));

    (new SweepAgentThreadsJob)->handle();
    expect(collect(app(Schedule::class)->events())->contains(fn ($event) => $event->description === SweepAgentThreadsJob::class))->toBeTrue();
});

it('counts a PR without any check as green two minutes after its head came', function () use ($strand) {
    FakeGitHub::connected();
    FakeGitHub::link($this->project);
    $thread = $strand(['repository_github_id' => 700_000_001, 'pr_number' => 12, 'head_sha' => str_repeat('a', 40)]);
    WorkItemLink::factory()->create(['work_item_id' => $thread->work_item_id, 'number' => 12, 'thread_id' => $thread->id, 'head_seen_at' => now()]);

    expect(SweepAgentThreads::run($this->system))->toBe(0);
    $this->travel(3)->minutes();
    expect(SweepAgentThreads::run($this->system))->toBe(1)
        ->and(AgentRun::query()->sole()->only(['type', 'head_sha']))->toBe(['type' => RunType::Review, 'head_sha' => str_repeat('a', 40)]);
});

it('leaves a strand that ended, pauses or already has a correction of the commit, and adds findings to one that waits', function () use ($strand) {
    $thread = $strand(['repository_github_id' => 700_000_001, 'pr_number' => 12]);
    $first = StartCorrection::run($this->system, $thread, 'ci', 'red one', 'sha1');

    expect(StartCorrection::run($this->system, $thread, 'review', 'red two', 'sha1')?->id)->toBe($first->id)
        ->and($first->fresh()->context['findings'])->toBe("red one\n\nred two");

    $first->forceFill(['status' => RunStatus::Succeeded])->save();
    expect(StartCorrection::run($this->system, $thread, 'ci', 'again', 'sha1'))->toBeNull()
        ->and(StartCorrection::run($this->system, $strand(['status' => AgentThread::MERGED]), 'ci', 'x'))->toBeNull()
        ->and(StartCorrection::run($this->system, $strand(['status' => AgentThread::PAUSED, 'pause_reason' => 'guard']), 'ci', 'x', null, true))->toBeNull()
        ->and(StartCorrection::run($this->system, $strand(['status' => AgentThread::PAUSED, 'pause_reason' => 'brake']), 'ci', 'x'))->toBeNull();

    AgentConfig::query()->where('bot_id', $this->kira->id)->update(['enabled' => false]);
    expect(StartCorrection::run($this->system, $strand(), 'ci', 'x'))->toBeNull();
});

it('pauses a strand at the brake of conflicts and runs one conflict of a commit', function () use ($strand) {
    AgentProjectSettings::factory()->create(['project_id' => $this->project->id, 'max_conflicts' => 1]);
    $thread = $strand();
    $review = AgentRun::factory()->type(RunType::Review)->create(['bot_id' => $this->kira->id, 'project_id' => $this->project->id, 'work_item_id' => $thread->work_item_id, 'thread_id' => $thread->id]);

    $conflict = StartConflict::run($this->system, $thread, 'sha1');
    expect($conflict)->not->toBeNull()->and($review->fresh()->status)->toBe(RunStatus::Canceled)
        ->and(StartConflict::run($this->system, $thread, 'sha2'))->toBeNull();

    $conflict->forceFill(['status' => RunStatus::Succeeded])->save();
    expect(StartConflict::run($this->system, $thread, 'sha1'))->toBeNull()
        ->and(StartConflict::run($this->system, $thread, 'sha2'))->toBeNull()
        ->and($thread->fresh()->only(['status', 'pause_reason']))->toBe(['status' => 'paused', 'pause_reason' => 'brake'])
        ->and(Comment::query()->latest('id')->first()->body_text)->toContain(__('agents.findings.conflict'));

    AgentConfig::query()->where('bot_id', $this->kira->id)->update(['enabled' => false]);
    expect(StartConflict::run($this->system, $strand(), 'sha3'))->toBeNull();
});

it('pauses the strand of another bot and starts afresh, and lets a child join the epic of the bot only when its strand is free', function () use ($strand) {
    $otto = AgentWorld::agent([$this->project], [], 'Otto');
    $item = WorkItem::factory()->for($this->project)->create(['assignee_id' => $this->kira->id]);
    $old = $strand(['bot_id' => $otto->id], $item);

    $run = StartTask::run($this->system, $item, $this->kira);
    expect($old->fresh()->only(['status', 'pause_reason']))->toBe(['status' => 'paused', 'pause_reason' => 'reassigned'])
        ->and($run->thread_id)->not->toBe($old->id);

    $epic = WorkItem::factory()->for($this->project)->epic()->create(['assignee_id' => $this->kira->id]);
    $busy = WorkItem::factory()->for($this->project)->childOf($epic)->create(['assignee_id' => $this->kira->id]);
    StartTask::run($this->system, $epic, $this->kira);
    expect(StartTask::run($this->system, $busy, $this->kira))->toBeNull();

    AgentRun::query()->where('work_item_id', $busy->id)->update(['status' => 'succeeded']);
    $late = WorkItem::factory()->for($this->project)->childOf($epic)->create(['assignee_id' => $this->kira->id]);
    expect(StartTask::run($this->system, $late, $this->kira)?->thread_id)->toBe(AgentThread::query()->where('work_item_id', $epic->id)->value('id'));

    // a strand of the bot pausing for the guard stays as it is; an agent switched off starts nothing
    $held = WorkItem::factory()->for($this->project)->create(['assignee_id' => $this->kira->id]);
    $strand(['status' => AgentThread::PAUSED, 'pause_reason' => 'guard'], $held);
    expect(StartTask::run($this->system, $held, $this->kira))->toBeNull();
    AgentConfig::query()->where('bot_id', $this->kira->id)->update(['enabled' => false]);
    expect(StartTask::enqueue($this->system, $this->kira, $old, $item, null))->toBeNull();
});

it('reviews with the review agent of the project and falls back to the bot of the strand', function () use ($strand) {
    $rita = AgentWorld::agent([$this->project], [], 'Rita');
    $settings = AgentProjectSettings::factory()->create(['project_id' => $this->project->id, 'review_bot_id' => $rita->id]);
    $pr = ['repository_github_id' => 700_000_001, 'repository' => 'feldwerk/website', 'number' => 3, 'head_sha' => str_repeat('a', 40), 'base_branch' => 'main'];
    $thread = $strand();

    $first = StartReview::run($this->system, $this->project, $pr, $thread, null);
    expect($first->bot_id)->toBe($rita->id)
        ->and(StartReview::run($this->system, $this->project, $pr, $thread, null))->toBeNull();

    // a new head: the review of the old one goes
    StartReview::run($this->system, $this->project, [...$pr, 'head_sha' => str_repeat('c', 40)], $thread, null);
    expect($first->fresh()->status)->toBe(RunStatus::Canceled);

    AgentConfig::query()->where('bot_id', $rita->id)->update(['enabled' => false]);
    expect(StartReview::reviewer($this->project, $thread)?->id)->toBe($this->kira->id)
        ->and(StartReview::reviewer($this->project, null))->toBeNull();

    $settings->update(['review_bot_id' => null]);
    AgentConfig::query()->where('bot_id', $this->kira->id)->update(['enabled' => false]);
    expect(StartReview::run($this->system, $this->project, [...$pr, 'head_sha' => str_repeat('b', 40)], $thread, null))->toBeNull();
});

it('asks nothing of an agent that cannot answer in the project', function () {
    $item = WorkItem::factory()->for($this->project)->create();
    $comment = Comment::factory()->for($item, 'workItem')->create();
    $this->project->forceFill(['archived_at' => now()])->save();

    expect(StartComment::run($this->system, $item->fresh(), $this->kira, $comment))->toBeNull();

    $this->project->forceFill(['archived_at' => null])->save();
    AgentConfig::query()->where('bot_id', $this->kira->id)->update(['enabled' => false]);
    expect(StartComment::run($this->system, $item->fresh(), $this->kira, $comment))->toBeNull();
});

it('knows why a bot cannot be an agent in a project', function () {
    $default = User::defaultBot();
    $plain = User::factory()->bot(User::factory()->create())->create();
    $stranger = AgentWorld::agent([], [], 'Otto');

    expect(AgentFlow::refusal($plain, $this->project))->toBe('agent_off')
        ->and(AgentFlow::refusal(User::factory()->create(), $this->project))->toBe('agent_off')
        ->and(AgentFlow::refusal($stranger, $this->project))->toBe('not_member')
        ->and(AgentFlow::refusal($this->kira, Project::factory()->create(['archived_at' => now()])))->toBe('archived');

    // the default bot and a deactivated bot say so before their agent, set up or not (no way to set one up helps)
    expect(AgentFlow::refusal($default, $this->project))->toBe('default_bot');
    AgentConfig::factory()->create(['bot_id' => $default->id]);
    expect(AgentFlow::refusal($default, $this->project))->toBe('default_bot');
    $plain->forceFill(['disabled_at' => now()])->save();
    expect(AgentFlow::refusal($plain, $this->project))->toBe('disabled');

    // a bot without a responsible person, and a deactivated one, each with its own code (A647)
    $this->kira->forceFill(['owner_id' => null])->save();
    expect(AgentFlow::refusal($this->kira, $this->project))->toBe('no_owner');
    $this->kira->forceFill(['disabled_at' => now()])->save();
    expect(AgentFlow::refusal($this->kira, $this->project))->toBe('disabled');
});

it('moves only where the workflow lets it and says so otherwise', function () {
    $item = WorkItem::factory()->for($this->project)->create(['state_id' => $this->states['Todo']]);
    $matrix = Workflow::factory()->matrix([[0, 1]])->create();
    $states = $matrix->states->pluck('id', 'name');
    $matrix->forceFill(['agent_states' => ['working' => $states['Doing'], 'review' => $states['Doing'], 'correction' => $states['Backlog'], 'merged' => $states['Done']]])->save();
    $strict = Project::factory()->create(['workflow_id' => $matrix->id]);
    $stuck = WorkItem::factory()->for($strict)->create(['state_id' => $states['Doing']]);
    app(RoleAssignments::class)->setProjectRole($this->kira, $strict, ProjectRole::Member);

    DB::transaction(function () use ($stuck, $item) {
        AgentFlow::move($this->kira, $stuck, AgentStep::Merged);
        AgentFlow::move($this->kira, $item, AgentStep::Working);
        AgentFlow::move($this->kira, $item, AgentStep::Working);
    });
    expect($stuck->fresh()->state_id)->toBe($states['Doing'])
        ->and(Comment::query()->where('work_item_id', $stuck->id)->sole()->body_text)->toContain('Doing')
        ->and($item->fresh()->state_id)->toBe($this->states['In Progress'])
        ->and(eventsOf(EventType::WorkItemStateChanged, $item))->toHaveCount(1);

    // closed items stay (only „Gemergt“ moves a closed one), archived ones too
    $item->forceFill(['state_id' => $this->states['Done']])->save();
    DB::transaction(fn () => AgentFlow::move($this->kira, $item, AgentStep::Correction));
    expect($item->fresh()->state_id)->toBe($this->states['Done']);
});

it('reports what the agent cannot assign or say instead of failing', function () {
    Exceptions::fake();
    $item = WorkItem::factory()->for($this->project)->create();

    DB::transaction(fn () => AgentFlow::assign($this->kira, $item, User::factory()->create()->id));
    $item->forceFill(['archived_at' => now(), 'state_id' => $this->states['Done']])->save();
    AgentFlow::comment($this->kira, $item->fresh(), 'Hello');
    DB::transaction(fn () => AgentFlow::assign($this->kira, $item->fresh(), $this->kira->id));

    Exceptions::assertReported(fn (RuntimeException $e) => $e->getMessage() === "The agent could not assign item {$item->id}.");
    Exceptions::assertReported(fn (RuntimeException $e) => $e->getMessage() === "The agent could not comment at item {$item->id}.");
    expect($item->fresh()->assignee_id)->toBeNull();
});

it('reads only the comments of people since the last run as findings', function () use ($strand, $ended) {
    $thread = $strand();
    $item = WorkItem::query()->find($thread->work_item_id);
    expect(AgentFlow::commentsSince($thread, $item))->toBe(__('agents.findings.no_comments'));

    $mara = User::factory()->admin()->create(['name' => 'Mara']);
    AddComment::run(actor($mara), $item, ['body' => 'Before.']);
    $this->travel(1)->minutes();
    $ended($thread, RunType::Task, RunStatus::Failed);
    $this->travel(1)->minutes();
    AddComment::run(actor($mara), $item, ['body' => 'After.']);
    AddComment::run(actor($this->kira), $item, ['body' => 'A bot.']);

    expect(AgentFlow::commentsSince($thread, $item))->toBe('Mara: After.');
});

it('pauses a strand only once and leaves one that ended', function () use ($strand) {
    $thread = $strand(['status' => AgentThread::CLOSED]);
    expect(PauseThread::run($this->system, $thread, 'reassigned')->status)->toBe(AgentThread::CLOSED)
        ->and(CompleteThread::run($this->system, $thread, 'merged')->status)->toBe(AgentThread::CLOSED);

});

it('ends the strand of a PR closed without a merge with „Korrektur“', function () use ($strand) {
    FakeGitHub::connected();
    FakeGitHub::link($this->project);
    $thread = $strand(['repository_github_id' => 700_000_001, 'pr_number' => 12, 'branch' => 'agent/x']);

    expect(HandleAgentPullRequest::run($this->system, FakeGitHub::pullRequest('closed', 12, ['state' => 'closed', 'head' => ['ref' => 'agent/x', 'sha' => str_repeat('a', 40)]])))->toBe('closed')
        ->and($thread->fresh()->status)->toBe(AgentThread::CLOSED)
        ->and(WorkItem::query()->find($thread->work_item_id)->state_id)->toBe($this->states['Todo'])
        ->and(Comment::query()->sole()->body_text)->toContain('#12');

    // a PR without a strand, of a repo of no project, or without a head: nothing
    expect(HandleAgentPullRequest::run($this->system, FakeGitHub::pullRequest('opened', 99)))->toBe('ignored')
        ->and(HandleAgentPullRequest::run($this->system, FakeGitHub::pullRequest('opened', 99, [], 1)))->toBe('ignored')
        ->and(HandleAgentPullRequest::run($this->system, FakeGitHub::pullRequest('opened', 12, ['head' => null])))->toBe('ignored');

    // a delivery after the end changes nothing
    $paused = $strand(['repository_github_id' => 700_000_001, 'pr_number' => 13, 'branch' => 'agent/y', 'status' => AgentThread::PAUSED]);
    expect(HandleAgentPullRequest::run($this->system, FakeGitHub::pullRequest('synchronize', 13, ['head' => ['ref' => 'agent/y', 'sha' => str_repeat('c', 40)]])))->toBe('pushed')
        ->and($paused->fresh()->head_sha)->toBe(str_repeat('c', 40))
        ->and(HandleAgentPullRequest::run($this->system, FakeGitHub::pullRequest('edited', 13, ['head' => ['ref' => 'agent/y', 'sha' => str_repeat('c', 40)]])))->toBe('updated');
});

it('reviews a ready PR of a person only when the project wants it', function () {
    FakeGitHub::connected();
    FakeGitHub::link($this->project);
    $rita = AgentWorld::agent([$this->project], [], 'Rita');
    $settings = AgentProjectSettings::factory()->create(['project_id' => $this->project->id, 'review_bot_id' => $rita->id, 'review_person_prs' => false]);
    $link = WorkItemLink::factory()->create(['work_item_id' => WorkItem::factory()->for($this->project)->create()->id, 'number' => 7]);
    WorkItemLinkCheck::query()->create(['work_item_link_id' => $link->id, 'check_run_id' => 1, 'name' => 't', 'status' => 'completed', 'conclusion' => 'success', 'head_sha' => $link->head_sha]);

    expect(HandleCheckResult::run($this->system, 700_000_001, $link->head_sha))->toBe('nothing');
    $settings->update(['review_person_prs' => true]);
    expect(HandleCheckResult::run($this->system, 700_000_001, $link->head_sha))->toBe('review')
        ->and(HandleCheckResult::run($this->system, 1, $link->head_sha))->toBe('ignored');

    $this->project->forceFill(['deleting_at' => now()])->save();
    expect(HandleCheckResult::run($this->system, 700_000_001, $link->head_sha))->toBe('ignored');
});

it('lets the CI of an old head or a draft of an agent pass', function () use ($strand) {
    FakeGitHub::connected();
    FakeGitHub::link($this->project);
    $thread = $strand(['repository_github_id' => 700_000_001, 'pr_number' => 12, 'head_sha' => str_repeat('b', 40), 'pr_draft' => true]);
    $link = WorkItemLink::factory()->create(['work_item_id' => $thread->work_item_id, 'number' => 12, 'thread_id' => $thread->id, 'head_sha' => str_repeat('a', 40)]);
    WorkItemLinkCheck::query()->create(['work_item_link_id' => $link->id, 'check_run_id' => 1, 'name' => 't', 'status' => 'completed', 'conclusion' => 'failure', 'head_sha' => $link->head_sha]);

    expect(HandleCheckResult::run($this->system, 700_000_001, str_repeat('a', 40)))->toBe('nothing');
    $link->update(['head_sha' => str_repeat('b', 40)]);
    WorkItemLinkCheck::query()->update(['head_sha' => str_repeat('b', 40), 'conclusion' => 'success']);
    expect(HandleCheckResult::run($this->system, 700_000_001, str_repeat('b', 40)))->toBe('nothing');
});

it('asks for no conflict of an epic on its own branch before its end, but of an epic of rule A', function () use ($strand) {
    $github = FakeGitHub::connected();
    FakeGitHub::link($this->project);
    $epic = WorkItem::factory()->for($this->project)->epic()->create();
    WorkItem::factory()->for($this->project)->childOf($epic)->create();
    $github->pulls[12] = ['mergeable' => true];

    expect(CheckThreadMergeability::run($this->system, $strand(['repository_github_id' => 700_000_001, 'pr_number' => 12, 'per_child' => true], $epic)->id))->toBe('stale');
    AgentThread::query()->update(['status' => AgentThread::CLOSED]);
    expect(CheckThreadMergeability::run($this->system, $strand(['repository_github_id' => 700_000_001, 'pr_number' => 12, 'per_child' => false], $epic)->id))->toBe('clean');
});

it('asks GitHub whether the PR of a strand merges and runs a conflict when it does not', function () use ($strand) {
    $github = FakeGitHub::connected();
    FakeGitHub::link($this->project);
    $thread = $strand(['repository_github_id' => 700_000_001, 'pr_number' => 12]);

    $github->pulls[12] = ['mergeable' => null];
    expect(CheckThreadMergeability::run($this->system, $thread->id))->toBe('pending');
    $github->pulls[12] = ['mergeable' => true];
    expect(CheckThreadMergeability::run($this->system, $thread->id))->toBe('clean');
    $github->pulls[12] = ['state' => 'closed'];
    expect(CheckThreadMergeability::run($this->system, $thread->id))->toBe('closed');
    $github->pulls[12] = ['mergeable' => false, 'mergeable_state' => 'dirty'];
    expect(CheckThreadMergeability::run($this->system, $thread->id))->toBe('conflict')
        ->and(CheckThreadMergeability::run($this->system, $thread->id))->toBe('held')
        ->and(CheckThreadMergeability::run($this->system, 'nope'))->toBe('stale');

    // the job comes back while GitHub computes
    $github->pulls[12] = ['mergeable' => null];
    $job = (new CheckPullRequestMergeability($thread->id))->withFakeQueueInteractions();
    $job->handle();
    $job->assertReleased(CheckPullRequestMergeability::DELAY * 3);
});

it('merges at the commit decided on and handles what GitHub answers', function () use ($strand) {
    $github = FakeGitHub::connected();
    FakeGitHub::link($this->project);
    $sha = str_repeat('a', 40);
    $make = fn () => $strand(['repository_github_id' => 700_000_001, 'pr_number' => 12, 'head_sha' => $sha, 'merge_sha' => $sha, 'branch' => 'agent/x']);

    $github->pulls[12] = ['head' => ['sha' => $sha], 'mergeable' => null];
    $thread = $make();
    expect(MergeThread::run($this->system, $thread->id, $sha))->toBe('pending')
        ->and(MergeThread::run($this->system, $thread->id, 'other'))->toBe('stale');
    $job = (new MergeAgentPullRequest($thread->id, $sha))->withFakeQueueInteractions();
    $job->handle();
    $job->assertReleased(MergeAgentPullRequest::PENDING_DELAY);
    expect($job->middleware())->toHaveCount(1);

    $github->pulls[12] = ['head' => ['sha' => str_repeat('b', 40)]];
    expect(MergeThread::run($this->system, $thread->id, $sha))->toBe('moved')->and($thread->fresh()->merge_sha)->toBeNull();

    $github->pulls[12] = ['head' => ['sha' => $sha], 'mergeable' => false, 'mergeable_state' => 'dirty'];
    $thread = $make();
    expect(MergeThread::run($this->system, $thread->id, $sha))->toBe('conflict')->and(AgentRun::query()->where('thread_id', $thread->id)->sole()->type)->toBe(RunType::Conflict);

    $github->pulls[12] = ['head' => ['sha' => $sha]];
    $github->refuse = ['/repos/*/*/pulls/12/merge' => 409];
    $thread = $make();
    expect(MergeThread::run($this->system, $thread->id, $sha))->toBe('moved');

    $github->refuse = ['/repos/*/*/pulls/12/merge' => 405];
    $thread = $make();
    expect(MergeThread::run($this->system, $thread->id, $sha))->toBe('refused')
        ->and(Comment::query()->where('work_item_id', $thread->work_item_id)->sole()->body_text)->toContain('405')
        ->and(WorkItem::query()->find($thread->work_item_id)->state_id)->toBe($this->states['Todo']);

    $github->refuse = ['/repos/*/*/pulls/12/merge' => 502];
    $thread = $make();
    expect(fn () => MergeThread::run($this->system, $thread->id, $sha))->toThrow(GitHubUnavailable::class);

    // a branch GitHub does not delete after the merge is reported
    $github->refuse = ['/repos/*/*/git/refs/heads/*' => 422];
    $thread = $make();
    expect(MergeThread::run($this->system, $thread->id, $sha))->toBe('merged')->and($thread->fresh()->status)->toBe(AgentThread::MERGED);
});

it('posts nothing and marks nothing ready for what is gone, and only a draft', function () use ($strand) {
    $github = FakeGitHub::connected();
    FakeGitHub::link($this->project);
    $thread = $strand(['repository_github_id' => 700_000_001, 'pr_number' => 12, 'pr_draft' => true]);

    expect(PostReviewVerdict::run($this->system, 'nope'))->toBe('stale')
        ->and(MarkThreadReady::run($this->system, 'nope'))->toBe('stale');
    $github->pulls[12] = ['draft' => false];
    expect(MarkThreadReady::run($this->system, $thread->id))->toBe('ready');
    $github->pulls[12] = ['draft' => true];
    (new MarkPullRequestReady($thread->id))->handle();
    expect($github->ready)->toBe(['PR_fake12']);

    $run = AgentRun::factory()->type(RunType::Review)->create(['bot_id' => $this->kira->id, 'project_id' => $this->project->id, 'pr_number' => 12, 'head_sha' => str_repeat('a', 40),
        'status' => RunStatus::Succeeded, 'result' => ['verdict' => 'changes', 'text' => 'Important: x'], 'context' => ['person' => false]]);
    (new PostReviewVerdictJob($run->id))->handle();
    expect($github->comments[0]['body'])->toContain('Important: x');
});

it('refuses a ready mark GitHub answers with errors and names their types, never their text', function () {
    Http::fake(['*/graphql' => Http::sequence()
        ->push(['errors' => [['type' => 'FORBIDDEN', 'message' => 'Resource not accessible by integration'], ['type' => 'FORBIDDEN'], ['type' => 'lower case'], 'x']])
        ->push(['errors' => 'x'])]);

    expect(fn () => GitHubApi::markReady('t', 'PR_x'))->toThrow(GitHubUnavailable::class, 'GitHub refused markPullRequestReadyForReview: FORBIDDEN.')
        ->and(fn () => GitHubApi::markReady('t', 'PR_x'))->toThrow(GitHubUnavailable::class, 'GitHub refused markPullRequestReadyForReview.');
});

it('marks an epic ready with a token that may write contents (GraphQL refuses it without)', function () use ($strand) {
    $github = FakeGitHub::connected();
    FakeGitHub::link($this->project);
    $thread = $strand(['repository_github_id' => 700_000_001, 'pr_number' => 12, 'pr_draft' => true]);
    $github->pulls[12] = ['draft' => true];

    expect(MarkThreadReady::run($this->system, $thread->id))->toBe('marked');
    Http::assertSent(fn ($request) => str_ends_with($request->url(), '/access_tokens')
        && ($request->data()['permissions'] ?? null) === ['contents' => 'write', 'pull_requests' => 'write']);
});

it('makes an epic ready only when no child is open and says when there is no PR', function () use ($strand) {
    $epic = WorkItem::factory()->for($this->project)->epic()->create(['assignee_id' => $this->kira->id]);
    $thread = $strand(['repository_github_id' => 700_000_001], $epic);
    expect(ReadyEpic::run($this->system, $thread))->toBe('no_pr')
        ->and($epic->fresh()->state_id)->toBe($this->states['Todo']);

    WorkItem::factory()->for($this->project)->childOf($epic)->create(['state_id' => $this->states['Todo']]);
    expect(ReadyEpic::run($this->system, $thread))->toBe('waiting');
});

it('follows only the events it knows and the mentions it can answer', function () {
    $item = WorkItem::factory()->for($this->project)->create();
    $mara = User::factory()->admin()->create();
    $event = fn (EventType $type, array $meta, ?array $changes = null, ?User $by = null) => Event::query()->create([
        'type' => $type, 'actor_id' => ($by ?? $mara)->id, 'subject_type' => 'work_item', 'subject_id' => $item->id, 'project_id' => $this->project->id,
        'changes' => $changes, 'meta' => ['via' => 'ui', 'reason' => null, ...$meta], 'occurred_at' => now(),
    ]);
    $run = fn (EventType $type) => Event::query()->create(['type' => $type, 'actor_id' => $mara->id, 'subject_type' => 'agent_run', 'subject_id' => '01J0000000000000000000000Z', 'project_id' => $this->project->id, 'meta' => [], 'occurred_at' => now()]);

    expect(FollowEvent::run($this->system, $event(EventType::BotMentioned, ['bot_id' => $this->kira->id, 'source' => 'comment', 'comment_id' => 'nope'])))->toBe('ignored')
        ->and(FollowEvent::run($this->system, $event(EventType::BotMentioned, ['bot_id' => $this->kira->id, 'source' => 'description'])))->toBe('ignored')
        ->and(FollowEvent::run($this->system, $event(EventType::BotAssigned, ['bot_id' => 'nope'])))->toBe('ignored')
        ->and(FollowEvent::run($this->system, $event(EventType::WorkItemUpdated, [])))->toBe('ignored')
        ->and(FollowEvent::run($this->system, $event(EventType::WorkItemAssigned, [], ['assignee_id' => ['old' => null, 'new' => $mara->id]])))->toBe('ignored')
        ->and(FollowEvent::run($this->system, $event(EventType::WorkItemStateChanged, [], ['state_id' => ['old' => null, 'new' => $this->states['Todo']]])))->toBe('ignored')
        ->and(FollowEvent::run($this->system, $event(EventType::BotAssigned, ['bot_id' => $this->kira->id, 'via' => 'template'], null, User::defaultBot())))->toBe('ignored')
        ->and(FollowEvent::run($this->system, $run(EventType::AgentRunStarted)))->toBe('ignored')
        ->and(FollowEvent::run($this->system, $run(EventType::AgentRunFinished)))->toBe('ignored');

    // a template assigned the agent: it works
    $item->forceFill(['assignee_id' => $this->kira->id])->save();
    expect(FollowEvent::run($this->system, $event(EventType::BotAssigned, ['bot_id' => $this->kira->id, 'via' => 'template'], null, User::defaultBot())))->toBe('task');

    // a strand assigned to its own bot again by the change: nothing to pause
    expect(FollowEvent::run($this->system, $event(EventType::WorkItemAssigned, [], ['assignee_id' => ['old' => null, 'new' => $this->kira->id]])))->toBe('ignored');

    (new AgentConsumer)->consume($event(EventType::WorkItemUpdated, []));
    expect([(new AgentConsumer)->key(), (new AgentConsumer)->queue(), (new AgentConsumer)->tries(), (new AgentConsumer)->backoff()])->toBe(['agents', 'default', 5, [10, 60, 300]]);
});

it('sets a strand with a PR back to a correction when a person puts its item back', function () use ($strand) {
    $mara = User::factory()->admin()->create();
    $thread = $strand(['repository_github_id' => 700_000_001, 'pr_number' => 12]);
    $item = WorkItem::query()->find($thread->work_item_id);
    $item->forceFill(['state_id' => $this->states['Pending']])->save();
    consumers(AgentConsumer::class);

    UpdateWorkItem::run(actor($mara), $item, ['state_id' => $this->states['Backlog']]);

    expect(AgentRun::query()->sole()->only(['type', 'thread_id']))->toBe(['type' => RunType::Correction, 'thread_id' => $thread->id]);
});

it('queues a run with the model of the label of its item and names the label', function () {
    $label = Label::factory()->create(['agent_model' => 'claude:haiku']);
    $item = WorkItem::factory()->for($this->project)->create();
    $item->labels()->attach($label->id);
    AgentProjectSettings::factory()->create(['project_id' => $this->project->id, 'models' => ['task' => 'claude:opus']]);

    $run = EnqueueRun::run($this->system, $this->kira, $this->project, $item, 'task', null, ['repository_github_id' => 1, 'pr_number' => 2]);
    expect($run->only(['model', 'model_source', 'model_label_id', 'repository_github_id', 'pr_number']))
        ->toBe(['model' => 'haiku', 'model_source' => 'label', 'model_label_id' => $label->id, 'repository_github_id' => 1, 'pr_number' => 2])
        ->and(EnqueueRun::run($this->system, $this->kira, $this->project, null, 'task', null)->only(['model', 'model_source']))->toBe(['model' => 'opus', 'model_source' => 'project']);
});

it('builds the job of every kind with the layers of the organization, the type and the project', function () use ($strand) {
    $item = WorkItem::factory()->for($this->project)->create(['title' => "Footer\nphone"]);
    $item->type->update(['agent_guidance' => 'Start with a failing test.']);
    AgentProjectSettings::factory()->create(['project_id' => $this->project->id, 'instructions' => 'Run pest in DDEV.']);
    $thread = $strand(['repository_github_id' => 700_000_001, 'branch' => 'agent/x', 'base_branch' => 'main', 'pr_number' => 3], $item);
    $make = fn (RunType $type, array $context, array $more = []) => RunPrompts::for(AgentRun::factory()->type($type)->create([
        'bot_id' => $this->kira->id, 'project_id' => $this->project->id, 'work_item_id' => $item->id, 'thread_id' => $thread->id, 'context' => $context, ...$more,
    ]));

    $correction = $make(RunType::Correction, ['source' => 'review', 'findings' => 'Important: no test']);
    expect($correction['system_prompt'])->toContain('# How to work on items of this type')->toContain('Start with a failing test.')->toContain('# The project')->toContain('Run pest in DDEV.')
        ->and($correction['prompt'])->toContain("```text\nFooter phone\n```")->toContain('The pull request is #3.')->toContain('from review')->toContain('Important: no test')
        ->and($make(RunType::Conflict, [])['prompt'])->toContain('base branch `main`')
        ->and($make(RunType::Comment, ['author' => 'Mara', 'question' => 'Why?'])['prompt'])->toContain('Mara asked you')
        ->and($make(RunType::Review, ['repository' => 'feldwerk/website', 'base_branch' => 'main'], ['pr_number' => 3, 'head_sha' => 'abc', 'work_item_id' => null])['prompt'])->toContain('It names no item of the project.')
        // a review has no shell and no token: it reads the files the runner put down (A493), never `gh`
        ->toContain('`pull-request.diff`')->toContain('`pull-request-log.txt`')->not->toContain('gh pr')
        ->and($correction['prompt'])->toEndWith(RunPrompts::DATA);
});

it('makes a correction of the findings of a review at the head of the strand and forgets its verdict', function () use ($strand, $ended) {
    $sha = str_repeat('a', 40);
    $thread = $strand(['repository_github_id' => 700_000_001, 'pr_number' => 12, 'head_sha' => $sha]);
    Queue::fake([PostReviewVerdictJob::class]);

    $review = $ended($thread, RunType::Review, RunStatus::Succeeded, ['head_sha' => $sha, 'repository_github_id' => 700_000_001, 'pr_number' => 12,
        'result' => ['verdict' => 'changes', 'text' => 'Important: no test.']]);

    expect(HandleRunResult::run($this->system, $review))->toBe('changes')
        ->and(AgentRun::query()->where('type', 'correction')->sole()->context)->toMatchArray(['source' => 'review', 'findings' => 'Important: no test.'])
        ->and($thread->fresh()->only(['review_sha', 'review_verdict']))->toBe(['review_sha' => null, 'review_verdict' => null]);
    Queue::assertPushed(PostReviewVerdictJob::class);
});

it('cancels what of a strand still runs when it completes', function () use ($strand) {
    $thread = $strand();
    $run = AgentRun::factory()->type(RunType::Task)->create(['bot_id' => $this->kira->id, 'project_id' => $this->project->id, 'work_item_id' => $thread->work_item_id, 'thread_id' => $thread->id]);

    CompleteThread::run($this->system, $thread, 'merged');

    expect($run->fresh()->status)->toBe(RunStatus::Canceled)->and($thread->fresh()->status)->toBe(AgentThread::MERGED);
});

it('decides again under the lock: a strand that ended meanwhile or got its PR', function () use ($strand) {
    FakeGitHub::connected();
    FakeGitHub::link($this->project);
    $thread = $strand(['repository_github_id' => 700_000_001, 'pr_number' => 12, 'branch' => 'agent/x']);
    $meanwhile = function (AgentThread $thread, array $changes) {
        $done = false;
        DB::connection()->beforeExecuting(function (string $sql) use (&$done, $changes, $thread) {
            if (! $done && str_contains($sql, 'from `agent_threads`') && str_contains($sql, 'for update')) {
                $done = true;
                AgentThread::query()->whereKey($thread->id)->update($changes);
            }
        });
    };

    $meanwhile($thread, ['status' => AgentThread::MERGED]);
    expect(HandleAgentPullRequest::run($this->system, FakeGitHub::pullRequest('synchronize', 12, ['head' => ['ref' => 'agent/x', 'sha' => str_repeat('c', 40)]])))->toBe('ended');

    $waiting = $strand(['awaiting_pr_since' => now()->subMinutes(5)]);
    $meanwhile($waiting, ['pr_number' => 30]);
    expect(SweepAgentThreads::noPr($waiting))->toBe(0);
});

it('takes a merge GitHub answers without its commit as refused', function () use ($strand) {
    $github = FakeGitHub::connected();
    FakeGitHub::link($this->project);
    $sha = str_repeat('a', 40);
    $thread = $strand(['repository_github_id' => 700_000_001, 'pr_number' => 12, 'head_sha' => $sha, 'merge_sha' => $sha]);
    $github->pulls[12] = ['head' => ['sha' => $sha]];
    $github->mergeAnswer = ['merged' => true];

    expect(MergeThread::run($this->system, $thread->id, $sha))->toBe('refused');
});

it('ignores a delivery of an event it does not work, and keeps one sweep at a time', function () {
    FakeGitHub::connected();
    FakeGitHub::deliver($this, 'issues', ['action' => 'opened'], 'issue-1')->assertStatus(202);

    expect(GitHubDelivery::query()->where('delivery_id', 'issue-1')->value('outcome'))->toBe('ignored')
        ->and((new SweepAgentThreadsJob)->middleware())->toHaveCount(1);
});
