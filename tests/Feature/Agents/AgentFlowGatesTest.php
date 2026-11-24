<?php

use App\Actions\Agents\ApproveAndMerge;
use App\Actions\Agents\GiveUpOnThread;
use App\Actions\Agents\HandleRunResult;
use App\Actions\Agents\MergeThread;
use App\Actions\Agents\PostReviewVerdict;
use App\Actions\Agents\StartComment;
use App\Actions\Agents\StartCorrection;
use App\Actions\Agents\StartTask;
use App\Actions\Agents\SweepAgentThreads;
use App\Actions\Comments\AddComment;
use App\Actions\WorkItems\UpdateWorkItem;
use App\Agents\AgentConsumer;
use App\Domain\Agents\RunStatus;
use App\Domain\Agents\RunType;
use App\Events\EventType;
use App\Events\Outbox;
use App\Jobs\MarkPullRequestReady;
use App\Jobs\MergeAgentPullRequest;
use App\Jobs\PostReviewVerdict as PostReviewVerdictJob;
use App\Models\AgentProjectSettings;
use App\Models\AgentRun;
use App\Models\AgentThread;
use App\Models\Comment;
use App\Models\Label;
use App\Models\Project;
use App\Models\ProjectRepository;
use App\Models\User;
use App\Models\Workflow;
use App\Models\WorkItem;
use App\Models\WorkItemLink;
use App\Models\WorkItemType;
use App\Support\Actor;
use App\Support\OwnMerges;
use Tests\Support\AgentWorld;
use Tests\Support\FakeGitHub;
use Tests\TestCase;

/*
 * The gates of the flow of the agents (review of PR #75): CI and review decide nothing while a run that changes code is
 * at work, a head counts green only from check runs (or from GitHub's word that there are none), an epic is reviewed
 * once it is ready, a person's PR that moved on gets no approve, the guard holds every merge, a merge whose answer got
 * lost finishes, and what a person does to an item of an agent ends what the agent does there.
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
    [$this->runner, $this->token] = AgentWorld::runner();
    $this->mara = User::factory()->admin()->create(['name' => 'Mara']);
    $this->system = Actor::system(User::defaultBot(), 'test');
});

$claim = fn (TestCase $test): ?array => $test->postJson('/api/runner/claim', [], AgentWorld::headers($test->token))->assertOk()->json('run');

$finish = fn (TestCase $test, array $run, array $result) => $test->postJson("/api/runner/runs/{$run['id']}/result", ['attempt' => $run['attempt'], 'status' => 'succeeded', ...$result], AgentWorld::headers($test->token))->assertOk();

$assign = fn (TestCase $test, WorkItem $item, User $to) => UpdateWorkItem::run(actor($test->mara), $item, ['assignee_id' => $to->id]);

$pr = function (TestCase $test, string $action, string $sha, array $more = [], int $number = 12): void {
    $thread = AgentThread::query()->latest('id')->firstOrFail();
    FakeGitHub::deliver($test, 'pull_request', FakeGitHub::pullRequest($action, $number, [
        'author' => 'feldwerk-werkbuch[bot]', 'title' => 'Change things', 'body' => 'Fixes',
        'head' => ['ref' => $thread->branch, 'sha' => $sha, 'label' => 'feldwerk:'.$thread->branch], ...$more,
    ]))->assertStatus(202);
    $test->github->pulls[$number] = ['head' => ['sha' => $sha, 'ref' => $thread->branch], 'draft' => $more['draft'] ?? false];
};

$ci = fn (TestCase $test, string $sha, string $conclusion, int $id = 3_000_001, string $name = 'tests') => FakeGitHub::deliver($test, 'check_run', FakeGitHub::checkRun($sha, 'completed', $conclusion, $id, $name))->assertStatus(202);

/** A check run as GET /commits/{sha}/check-runs lists it. */
$listed = fn (string $sha, string $status, ?string $conclusion = null, int $id = 3_000_009, string $name = 'lint') => FakeGitHub::checkRun($sha, $status, $conclusion, $id, $name)['check_run'];

/** The runs of a kind, as their head commits. */
$heads = fn (string $type) => AgentRun::query()->where('type', $type)->orderBy('id')->pluck('head_sha')->all();

it('decides nothing on the CI of a strand while its run that changes code is at work and looks at the head when it ends', function () use ($claim, $finish, $assign, $pr, $ci, $heads) {
    $this->kira->forceFill(['owner_id' => $this->mara->id])->save();
    $item = WorkItem::factory()->for($this->project)->create(['state_id' => $this->states['Todo']]);
    [$a, $b] = [str_repeat('a', 40), str_repeat('b', 40)];
    $assign($this, $item, $this->kira);
    $task = $claim($this);

    // pushes in between: red and green CI start neither a correction nor a review
    $pr($this, 'opened', $a);
    $ci($this, $a, 'failure');
    $pr($this, 'synchronize', $b);
    $ci($this, $b, 'success', 3_000_002);
    expect($heads('correction'))->toBe([])->and($heads('review'))->toBe([])->and($item->fresh()->state_id)->toBe($this->states['In Progress']);

    // the end of the task looks at its head: green, a review
    $finish($this, $task, ['commit' => $b]);
    expect($heads('review'))->toBe([$b])->and($heads('correction'))->toBe([]);

    // a person sets the item back while the review runs: its approve merges nothing while the correction waits
    $review = $claim($this);
    UpdateWorkItem::run(actor($this->mara), $item->fresh(), ['state_id' => $this->states['Todo']]);
    $finish($this, $review, ['verdict' => 'approve', 'text' => 'Verdict: approve']);
    // held: no approve at the PR, the links keep no verdict, the item says why (A610)
    expect(collect($this->github->comments)->contains(fn (array $comment) => str_contains($comment['body'], "werkbuch-run:{$review['id']}")))->toBeFalse()
        ->and(WorkItemLink::query()->sole()->review)->toBeNull()
        ->and(Comment::query()->where('work_item_id', $item->id)->latest('id')->first()->body_text)->toContain('approved while a correction runs')
        ->and(Comment::query()->where('work_item_id', $item->id)->latest('id')->first()->run_id)->toBe($review['id']);
    expect($this->github->merges)->toBe([])->and($heads('correction'))->toHaveCount(1)
        ->and(ApproveAndMerge::run($this->system, AgentThread::query()->sole()))->toBeFalse()
        ->and(StartCorrection::run($this->system, AgentThread::query()->sole(), 'ci', 'red', str_repeat('c', 40)))->not->toBeNull()
        ->and(AgentThread::query()->sole()->only(['review_sha', 'review_verdict']))->toBe(['review_sha' => null, 'review_verdict' => null]);

    // the correction ends without a commit (A606): the approve of before merges nothing, the owner gets the item
    $correction = $claim($this);
    expect($correction['type'])->toBe('correction')->and(AgentRun::query()->findOrFail($correction['id'])->context['start_head'])->toBe($b);
    $finish($this, $correction, ['summary' => 'Nothing to change here.']);
    $thread = AgentThread::query()->sole();
    expect($this->github->merges)->toBe([])->and($thread->merge_sha)->toBeNull()
        ->and($thread->only(['status', 'pause_reason']))->toBe(['status' => 'paused', 'pause_reason' => 'no_change'])
        ->and($item->fresh()->only(['state_id', 'assignee_id']))->toBe(['state_id' => $this->states['Todo'], 'assignee_id' => $this->mara->id])
        ->and(Comment::query()->where('work_item_id', $item->id)->latest('id')->first()->body_text)->toContain('No change')->toContain('Nothing to change here.')
        ->and(Comment::query()->where('work_item_id', $item->id)->latest('id')->first()->run_id)->toBe($correction['id'])
        ->and($heads('review'))->toBe([$b])->and($claim($this))->toBeNull();
});

it('takes no findings of CI or review while a run of the strand that changes code runs, and starts nothing for a run stopped by hand', function () use ($claim, $assign) {
    $item = WorkItem::factory()->for($this->project)->create(['state_id' => $this->states['Todo']]);
    $assign($this, $item, $this->kira);
    $task = $claim($this);
    $thread = AgentThread::query()->sole();
    expect(StartCorrection::run($this->system, $thread, 'ci', 'red', str_repeat('a', 40)))->toBeNull()
        ->and(StartCorrection::run($this->system, $thread, 'review', 'Important: no test', str_repeat('a', 40)))->toBeNull()
        ->and(AgentRun::query()->where('type', 'correction')->count())->toBe(0);

    // a child of an epic whose task someone stops by hand: the strand does not start it again
    $epic = WorkItem::factory()->for($this->project)->epic()->create(['state_id' => $this->states['Todo']]);
    $child = WorkItem::factory()->for($this->project)->childOf($epic)->create(['state_id' => $this->states['Todo']]);
    $this->postJson("/api/runner/runs/{$task['id']}/result", ['attempt' => 1, 'status' => 'succeeded'], AgentWorld::headers($this->token))->assertOk();
    $assign($this, $epic, $this->kira);
    $run = AgentRun::query()->where('work_item_id', $child->id)->sole();
    $run->forceFill(['status' => RunStatus::Canceled, 'finished_at' => now()])->save();
    expect(HandleRunResult::run($this->system, $run))->toBe('nothing')->and(AgentRun::query()->where('work_item_id', $child->id)->count())->toBe(1);
});

it('reads the check runs GitHub had of a head before the PR had it', function () use ($claim, $finish, $assign, $pr, $ci, $listed) {
    $item = WorkItem::factory()->for($this->project)->create(['state_id' => $this->states['Todo']]);
    [$a, $b] = [str_repeat('a', 40), str_repeat('b', 40)];
    $assign($this, $item, $this->kira);
    $task = $claim($this);
    $pr($this, 'opened', $a);
    $finish($this, $task, ['commit' => $a]);

    // the CI of the next commit comes first: no PR has that head yet, the delivery finds nothing
    $ci($this, $b, 'failure');
    expect(WorkItemLink::query()->sole()->checks)->toHaveCount(0);

    $this->github->checkRuns[$b] = [$listed($b, 'completed', 'failure', 3_000_001, 'tests')];
    $pr($this, 'synchronize', $b);
    $correction = AgentRun::query()->where('type', 'correction')->sole();
    expect($this->github->checkRunCalls)->toContain($b)
        ->and($correction->head_sha)->toBe($b)->and($correction->context['findings'])->toContain('tests: failure')
        ->and(WorkItemLink::query()->sole()->ci())->toBe('failure');
});

it('counts a head without check runs green only once GitHub says it has none after the commit settled', function () use ($claim, $finish, $assign, $pr, $heads, $listed) {
    $item = WorkItem::factory()->for($this->project)->create(['state_id' => $this->states['Todo']]);
    $a = str_repeat('a', 40);
    $assign($this, $item, $this->kira);
    $task = $claim($this);
    $pr($this, 'opened', $a);
    $finish($this, $task, ['commit' => $a]);

    // asked at once GitHub has none yet: not green
    expect(WorkItemLink::query()->sole()->checks_loaded_sha)->toBe($a)->and(SweepAgentThreads::run($this->system))->toBe(0)->and($heads('review'))->toBe([]);

    // two minutes later a check still runs: the sweep asks, the CI is pending
    $this->travel(3)->minutes();
    $this->github->checkRuns[$a] = [$listed($a, 'in_progress')];
    expect(SweepAgentThreads::run($this->system))->toBe(1)->and($heads('review'))->toBe([])
        ->and(SweepAgentThreads::run($this->system))->toBe(0);

    // another commit GitHub has no check of after it settled: green, a review
    $b = str_repeat('b', 40);
    $pr($this, 'synchronize', $b);
    $this->travel(3)->minutes();
    expect(SweepAgentThreads::run($this->system))->toBe(1)->and($heads('review'))->toBe([$b])
        ->and(collect($this->github->checkRunCalls)->filter(fn (string $sha) => $sha === $b))->toHaveCount(2);
});

it('never merges on a CI that GitHub does not have green, whatever reached werkbuch', function () use ($claim, $finish, $assign, $pr, $ci, $listed, $heads) {
    $item = WorkItem::factory()->for($this->project)->create(['state_id' => $this->states['Todo']]);
    $a = str_repeat('a', 40);
    $assign($this, $item, $this->kira);
    $task = $claim($this);
    $pr($this, 'opened', $a);
    $finish($this, $task, ['commit' => $a]);
    $ci($this, $a, 'success');

    // GitHub has a red check werkbuch never heard of
    $this->github->checkRuns[$a] = [$listed($a, 'completed', 'success', 3_000_001, 'tests'), $listed($a, 'completed', 'failure')];
    $finish($this, $claim($this), ['verdict' => 'approve', 'text' => 'Verdict: approve']);

    expect($this->github->merges)->toBe([])->and(AgentThread::query()->sole()->merge_sha)->toBeNull()
        ->and($heads('correction'))->toBe([$a])->and(AgentRun::query()->where('type', 'correction')->sole()->context['findings'])->toContain('lint: failure');
});

it('reviews and merges the PR of an epic only once werkbuch made it ready, also when the agent opened it as no draft', function () use ($claim, $finish, $assign, $pr, $ci, $heads) {
    $epic = WorkItem::factory()->for($this->project)->epic()->create(['state_id' => $this->states['Todo']]);
    WorkItem::factory()->for($this->project)->childOf($epic)->create(['state_id' => $this->states['Todo']]);
    WorkItem::factory()->for($this->project)->childOf($epic)->create(['state_id' => $this->states['Todo']]);
    $a = str_repeat('a', 40);

    $assign($this, $epic, $this->kira);
    $first = $claim($this);
    $pr($this, 'opened', $a);
    $finish($this, $first, ['commit' => $a]);
    $ci($this, $a, 'success');
    expect($heads('review'))->toBe([])->and(AgentThread::query()->sole()->ready_requested_at)->toBeNull();

    // the last child: ready (a PR that is no draft is not marked ready on GitHub), its green CI counts now
    $finish($this, $claim($this), ['commit' => $a]);
    expect(AgentThread::query()->sole()->ready_requested_at)->not->toBeNull()->and($this->github->ready)->toBe([])
        ->and($heads('review'))->toBe([$a])->and($epic->fresh()->state_id)->toBe($this->states['Pending']);
});

it('gives the PR of a person no approve of a commit it left, and cancels its review when it moves on', function () use ($claim, $ci) {
    $reviewer = AgentWorld::agent([$this->project], [], 'Rita');
    AgentProjectSettings::factory()->create(['project_id' => $this->project->id, 'review_bot_id' => $reviewer->id]);
    $item = WorkItem::factory()->for($this->project)->create(['state_id' => $this->states['Todo']]);
    [$one, $two] = [str_repeat('7', 40), str_repeat('8', 40)];

    FakeGitHub::deliver($this, 'pull_request', FakeGitHub::pullRequest('opened', 57, ['body' => "Fixes {$item->key}", 'head' => ['ref' => 'fix/footer', 'sha' => $one]]))->assertStatus(202);
    $ci($this, $one, 'success');
    $review = AgentRun::query()->findOrFail($claim($this)['id']);

    FakeGitHub::deliver($this, 'pull_request', FakeGitHub::pullRequest('synchronize', 57, ['body' => "Fixes {$item->key}", 'head' => ['ref' => 'fix/footer', 'sha' => $two], 'updated_at' => '2026-11-24T09:10:00Z']))->assertStatus(202);
    expect($review->fresh()->status)->toBe(RunStatus::Canceling);

    // its approve, should it still come: nothing at the PR, the links keep what they had
    $review->forceFill(['status' => RunStatus::Succeeded, 'finished_at' => now(), 'result' => ['verdict' => 'approve', 'text' => 'Verdict: approve']])->save();
    expect(HandleRunResult::run($this->system, $review))->toBe('stale')
        ->and(PostReviewVerdict::run($this->system, $review->id))->toBe('stale')
        ->and($this->github->reviews)->toBe([])
        ->and(WorkItemLink::query()->sole()->review)->toBeNull();
});

it('posts the verdict of a review once, also when the answer of GitHub got lost', function () {
    $thread = AgentThread::factory()->create(['bot_id' => $this->kira->id, 'project_id' => $this->project->id, 'repository_github_id' => 700_000_001, 'pr_number' => 12]);
    $run = AgentRun::factory()->type(RunType::Review)->create([
        'bot_id' => $this->kira->id, 'project_id' => $this->project->id, 'thread_id' => $thread->id, 'work_item_id' => $thread->work_item_id,
        'status' => RunStatus::Succeeded, 'finished_at' => now(), 'head_sha' => str_repeat('a', 40), 'repository_github_id' => 700_000_001, 'pr_number' => 12,
        'result' => ['verdict' => 'approve', 'text' => 'Fine.'],
    ]);

    expect(PostReviewVerdict::run($this->system, $run->id))->toBe('comment')
        ->and(PostReviewVerdict::run($this->system, $run->id, true))->toBe('posted')
        ->and($this->github->comments)->toHaveCount(1)->and($this->github->comments[0]['body'])->toContain(PostReviewVerdict::mark($run));

    // the job looks only on a later try
    $job = (new PostReviewVerdictJob($run->id))->withFakeQueueInteractions();
    $job->handle();
    expect($this->github->comments)->toHaveCount(2);
});

it('keeps the model of a label and the guidance of a type that a body leaves out, and clears them with null', function () {
    $this->actingAs($this->mara);
    $label = Label::factory()->create(['agent_model' => 'claude:haiku']);
    $this->putJson("/api/v1/labels/{$label->id}", ['name' => 'Copy', 'color' => 'moss'])->assertOk()->assertJsonPath('data.agent_model', 'claude:haiku');
    $this->putJson("/api/v1/labels/{$label->id}", ['name' => 'Copy', 'color' => 'moss', 'agent_model' => null])->assertOk()->assertJsonPath('data.agent_model', null);

    $type = WorkItemType::query()->where('name', 'Bug')->sole();
    $type->update(['agent_guidance' => 'Start with a failing test.']);
    $body = ['name' => 'Bug', 'icon' => $type->icon, 'tone' => $type->tone->value, 'is_epic' => false, 'properties' => []];
    $this->putJson("/api/v1/work-item-types/{$type->id}", $body)->assertOk()->assertJsonPath('data.agent_guidance', 'Start with a failing test.');
    $this->putJson("/api/v1/work-item-types/{$type->id}", [...$body, 'agent_guidance' => null])->assertOk()->assertJsonPath('data.agent_guidance', null);
});

it('merges nothing while the guard holds the project and keeps a strand assigned again paused for it', function () use ($claim, $finish, $assign, $pr, $ci) {
    $item = WorkItem::factory()->for($this->project)->create(['state_id' => $this->states['Todo']]);
    $a = str_repeat('a', 40);
    $assign($this, $item, $this->kira);
    $task = $claim($this);
    $pr($this, 'opened', $a);
    $finish($this, $task, ['commit' => $a]);
    $ci($this, $a, 'success');
    $review = $claim($this);

    // the guard holds the project when the approve comes
    ProjectRepository::query()->sole()->forceFill(['guard_detected_at' => now(), 'guard_sha' => str_repeat('6', 40), 'guard_branch' => 'main'])->save();
    $finish($this, $review, ['verdict' => 'approve', 'text' => 'Verdict: approve']);
    $thread = AgentThread::query()->sole();
    expect($this->github->merges)->toBe([])->and($thread->merge_sha)->toBeNull()
        ->and(MergeThread::run($this->system, $thread->id, 'x'))->toBe('stale');
    $thread->forceFill(['merge_sha' => $a])->save();
    expect(MergeThread::run($this->system, $thread->id, $a))->toBe('guarded')->and($thread->fresh()->merge_sha)->toBeNull();

    // a strand at its brake assigned again stays paused for the guard; its correction waits and runs after the confirmation
    $thread->forceFill(['status' => AgentThread::PAUSED, 'pause_reason' => 'brake', 'corrections' => 3])->save();
    $assign($this, $item->fresh(), $this->mara);
    $assign($this, $item->fresh(), $this->kira);
    expect($thread->fresh()->only(['status', 'pause_reason', 'corrections']))->toBe(['status' => 'paused', 'pause_reason' => 'guard', 'corrections' => 1])
        ->and(AgentRun::query()->where('type', 'correction')->sole()->status)->toBe(RunStatus::Waiting)
        ->and($claim($this))->toBeNull();

    $this->actingAs($this->mara)->postJson('/api/v1/projects/WEBU/repository/confirm-guard')->assertOk();
    expect($thread->fresh()->status)->toBe('open')->and($claim($this)['type'])->toBe('correction');
});

it('finishes a merge whose answer got lost and settles it as werkbuch’s own', function () {
    $sha = str_repeat('a', 40);
    $merge = str_repeat('f', 40);
    $item = WorkItem::factory()->for($this->project)->create(['state_id' => $this->states['Pending'], 'assignee_id' => $this->kira->id]);
    $thread = AgentThread::factory()->create(['bot_id' => $this->kira->id, 'project_id' => $this->project->id, 'work_item_id' => $item->id,
        'repository_github_id' => 700_000_001, 'pr_number' => 12, 'head_sha' => $sha, 'merge_sha' => $sha, 'branch' => 'agent/x']);
    $repository = ProjectRepository::query()->sole();

    // the first attempt asked GitHub and never heard back; GitHub merged
    OwnMerges::expect($repository->repository_id, 12);
    $this->github->pulls[12] = ['state' => 'closed', 'merged' => true, 'merge_commit_sha' => $merge, 'head' => ['sha' => $sha]];
    expect(MergeThread::run($this->system, $thread->id, $sha))->toBe('merged')
        ->and($thread->fresh()->status)->toBe(AgentThread::MERGED)->and($item->fresh()->state_id)->toBe($this->states['Done'])
        ->and($this->github->merges)->toBe([])->and($this->github->deletedBranches)->toBe(['agent/x'])
        ->and(OwnMerges::explain($repository->repository_id, $merge))->toBe(OwnMerges::OWN);

    // the push of that merge: werkbuch's own, the guard stays quiet
    FakeGitHub::deliver($this, 'push', FakeGitHub::push($merge))->assertStatus(202);
    expect($repository->fresh()->guard_detected_at)->toBeNull();

    // GitHub told of the merge first (the strand merged already): the next attempt still settles it
    $other = AgentThread::factory()->create(['bot_id' => $this->kira->id, 'project_id' => $this->project->id, 'repository_github_id' => 700_000_001,
        'pr_number' => 13, 'head_sha' => $sha, 'merge_sha' => $sha, 'status' => AgentThread::MERGED, 'branch' => 'agent/y']);
    OwnMerges::expect($repository->repository_id, 13);
    $this->github->pulls[13] = ['state' => 'closed', 'merged' => true, 'merge_commit_sha' => str_repeat('e', 40), 'head' => ['sha' => $sha]];
    expect(MergeThread::run($this->system, $other->id, $sha))->toBe('merged')
        ->and(OwnMerges::explain($repository->repository_id, str_repeat('e', 40)))->toBe(OwnMerges::OWN);
    $this->github->pulls[13] = ['state' => 'closed', 'merged' => false, 'head' => ['sha' => $sha]];
    expect(MergeThread::run($this->system, $other->id, $sha))->toBe('moved');
});

it('settles a merge from the delivery that tells of it before the answer came', function () use ($claim, $finish, $assign, $pr) {
    $item = WorkItem::factory()->for($this->project)->create(['state_id' => $this->states['Todo']]);
    $a = str_repeat('a', 40);
    $assign($this, $item, $this->kira);
    $task = $claim($this);
    $pr($this, 'opened', $a);
    $finish($this, $task, ['commit' => $a]);
    OwnMerges::expect(ProjectRepository::query()->sole()->repository_id, 12);

    $pr($this, 'closed', $a, ['state' => 'closed', 'merged' => true, 'merged_at' => '2026-11-24T10:00:00Z', 'merge_commit_sha' => str_repeat('f', 40)]);
    expect(OwnMerges::explain(ProjectRepository::query()->sole()->repository_id, str_repeat('f', 40)))->toBe(OwnMerges::OWN)
        ->and(AgentThread::query()->sole()->status)->toBe(AgentThread::MERGED);
});

it('gives up on a merge or a ready PR its job could not finish, and lets the next decide again', function () {
    $sha = str_repeat('a', 40);
    $item = WorkItem::factory()->for($this->project)->create(['state_id' => $this->states['Pending'], 'assignee_id' => $this->kira->id]);
    $thread = AgentThread::factory()->create(['bot_id' => $this->kira->id, 'project_id' => $this->project->id, 'work_item_id' => $item->id,
        'repository_github_id' => 700_000_001, 'pr_number' => 12, 'head_sha' => $sha, 'merge_sha' => $sha, 'ready_requested_at' => now()]);

    (new MergeAgentPullRequest($thread->id, $sha))->failed();
    expect($thread->fresh()->merge_sha)->toBeNull()->and($item->fresh()->state_id)->toBe($this->states['Todo'])
        ->and(Comment::query()->where('work_item_id', $item->id)->sole()->body_text)->toContain('#12');

    (new MarkPullRequestReady($thread->id))->failed();
    expect($thread->fresh()->ready_requested_at)->toBeNull()->and(Comment::query()->where('work_item_id', $item->id)->count())->toBe(2)
        ->and(GiveUpOnThread::run($this->system, $thread->id, 'ready'))->toBe('stale')
        ->and(GiveUpOnThread::run($this->system, $thread->id, 'merge', $sha))->toBe('stale')
        ->and(GiveUpOnThread::run($this->system, 'nope', 'merge', $sha))->toBe('stale')
        ->and((new MergeAgentPullRequest($thread->id, $sha))->middleware())->toHaveCount(1);
});

it('cancels the task of a child a person takes from the agent and goes on with the next child', function () use ($claim, $assign) {
    $epic = WorkItem::factory()->for($this->project)->epic()->create(['state_id' => $this->states['Todo']]);
    $form = WorkItem::factory()->for($this->project)->childOf($epic)->create(['state_id' => $this->states['Todo'], 'rank' => 'a0']);
    $map = WorkItem::factory()->for($this->project)->childOf($epic)->create(['state_id' => $this->states['Todo'], 'rank' => 'a1']);

    $assign($this, $epic, $this->kira);
    $first = $claim($this);
    expect($first['item']['key'])->toBe($form->key);

    // Mara takes the form: its task is stopped; the runner reports it canceled, the map comes next
    $assign($this, $form->fresh(), $this->mara);
    expect(AgentRun::query()->findOrFail($first['id'])->status)->toBe(RunStatus::Canceling);
    $this->postJson("/api/runner/runs/{$first['id']}/result", ['attempt' => 1, 'status' => 'canceled'], AgentWorld::headers($this->token))->assertOk();
    expect(AgentRun::query()->where('type', 'task')->where('status', 'queued')->sole()->work_item_id)->toBe($map->id);

    // a task that only waits ends at once; the epic waits for the child of Mara
    UpdateWorkItem::run(actor($this->mara), $map->fresh(), ['state_id' => $this->states['Cancelled']]);
    expect(AgentRun::query()->where('work_item_id', $map->id)->sole()->status)->toBe(RunStatus::Canceled)
        ->and(Comment::query()->where('work_item_id', $epic->id)->where('author_id', $this->kira->id)->exists())->toBeFalse();

    // Mara is done: no child is open, the epic is ready (no PR: a comment)
    UpdateWorkItem::run(actor($this->mara), $form->fresh(), ['state_id' => $this->states['Done']]);
    expect(Comment::query()->where('work_item_id', $epic->id)->where('author_id', $this->kira->id)->sole()->body_text)->toBe(__('agents.comment.no_pr'));
});

it('pauses the strand of an item a person cancels and leaves the item canceled when its PR is merged after all', function () use ($claim, $finish, $assign, $pr) {
    $item = WorkItem::factory()->for($this->project)->create(['state_id' => $this->states['Todo']]);
    $a = str_repeat('a', 40);
    $assign($this, $item, $this->kira);
    $task = $claim($this);
    $pr($this, 'opened', $a);
    $finish($this, $task, ['commit' => $a]);

    UpdateWorkItem::run(actor($this->mara), $item->fresh(), ['state_id' => $this->states['Cancelled']]);
    expect(AgentThread::query()->sole()->only(['status', 'pause_reason']))->toBe(['status' => 'paused', 'pause_reason' => 'canceled']);

    $pr($this, 'closed', $a, ['state' => 'closed', 'merged' => true, 'merged_at' => '2026-11-24T10:00:00Z']);
    expect(AgentThread::query()->sole()->status)->toBe(AgentThread::MERGED)->and($item->fresh()->state_id)->toBe($this->states['Cancelled']);
});

it('sets an item back to „Korrektur“ when the review of an agent PR fails, and moves nothing a person took meanwhile', function () use ($claim, $finish, $assign, $pr, $ci) {
    $item = WorkItem::factory()->for($this->project)->create(['state_id' => $this->states['Todo']]);
    $a = str_repeat('a', 40);
    $assign($this, $item, $this->kira);
    $task = $claim($this);
    $pr($this, 'opened', $a);
    $finish($this, $task, ['commit' => $a]);
    $ci($this, $a, 'success');
    $review = $claim($this);
    $this->postJson("/api/runner/runs/{$review['id']}/result", ['attempt' => 1, 'status' => 'failed', 'error' => 'claude: overloaded'], AgentWorld::headers($this->token))->assertOk();
    expect($item->fresh()->state_id)->toBe($this->states['Todo']);

    // a correction that ends after Mara took the item moves it nowhere
    $correction = AgentRun::factory()->type(RunType::Correction)->create(['bot_id' => $this->kira->id, 'project_id' => $this->project->id, 'work_item_id' => $item->id,
        'thread_id' => AgentThread::query()->sole()->id, 'status' => RunStatus::Succeeded, 'finished_at' => now()]);
    $item->fresh()->forceFill(['assignee_id' => $this->mara->id])->save();
    expect(HandleRunResult::run($this->system, $correction))->toBe('review')->and($item->fresh()->state_id)->toBe($this->states['Todo']);
});

it('starts the next child only once and answers only who may edit items', function () use ($assign) {
    $epic = WorkItem::factory()->for($this->project)->epic()->create(['state_id' => $this->states['Todo']]);
    $form = WorkItem::factory()->for($this->project)->childOf($epic)->create(['state_id' => $this->states['Todo'], 'rank' => 'a0']);
    $map = WorkItem::factory()->for($this->project)->childOf($epic)->create(['state_id' => $this->states['Todo'], 'rank' => 'a1']);
    $assign($this, $epic, $this->kira);
    $thread = AgentThread::query()->sole();
    expect(StartTask::nextChild($thread, $epic, $this->kira)?->id)->toBe($map->id);

    // a reader of a public project asks the agent nothing
    $reader = User::factory()->create();
    $comment = Comment::factory()->for($form, 'workItem')->create(['author_id' => $reader->id]);
    expect(StartComment::run($this->system, $form, $this->kira, $comment))->toBeNull()
        ->and(StartComment::run($this->system, $form, $this->kira, AddComment::run(actor($this->mara), $form, ['body' => '@kira why?'])))->not->toBeNull();
});

it('consumes an event that comes twice once', function () {
    consumers();
    $item = WorkItem::factory()->for($this->project)->create(['state_id' => $this->states['Todo']]);
    UpdateWorkItem::run(actor($this->mara), $item, ['assignee_id' => $this->kira->id]);
    $event = eventsOf(EventType::BotAssigned, $item)->sole();

    // the claim of the consumer: the second delivery of the event (a redispatch, a retry) does nothing
    expect(app(Outbox::class)->consume($event->id, AgentConsumer::class))->toBeTrue()
        ->and(app(Outbox::class)->consume($event->id, AgentConsumer::class))->toBeFalse()
        ->and(AgentRun::query()->count())->toBe(1);
});

it('keeps the findings of CI and a review that come while a correction runs and makes them a correction when it pushes nothing', function () use ($claim, $finish, $assign, $pr, $ci, $heads) {
    $item = WorkItem::factory()->for($this->project)->create(['state_id' => $this->states['Todo']]);
    [$a, $b] = [str_repeat('a', 40), str_repeat('b', 40)];
    $assign($this, $item, $this->kira);
    $task = $claim($this);
    $pr($this, 'opened', $a);
    $finish($this, $task, ['commit' => $a]);
    $ci($this, $a, 'failure');
    $correction = $claim($this);
    $thread = AgentThread::query()->sole();
    expect($correction['type'])->toBe('correction')->and($thread->corrections)->toBe(1);

    // the review of the commit asks for changes and another check fails while the correction runs: kept, not dropped
    $review = AgentRun::factory()->type(RunType::Review)->create(['bot_id' => $this->kira->id, 'project_id' => $this->project->id, 'work_item_id' => $item->id,
        'thread_id' => $thread->id, 'head_sha' => $a, 'repository_github_id' => 700_000_001, 'pr_number' => 12,
        'status' => RunStatus::Succeeded, 'finished_at' => now(), 'result' => ['verdict' => 'changes', 'text' => 'Important: the form has no label.']]);
    expect(HandleRunResult::run($this->system, $review))->toBe('changes');
    $ci($this, $a, 'failure', 3_000_002, 'lint');
    $ci($this, $a, 'failure', 3_000_002, 'lint');
    expect($thread->fresh()->pending_findings)->toMatchArray(['source' => 'review', 'head' => $a])
        ->and(substr_count($thread->fresh()->pending_findings['text'], 'lint: failure'))->toBe(1)
        ->and($heads('correction'))->toBe([$a]);

    // the correction pushes nothing: the kept findings make the next correction, the brake counts it
    $finish($this, $correction, []);
    $next = AgentRun::query()->where('type', 'correction')->latest('id')->firstOrFail();
    expect(AgentRun::query()->where('type', 'correction')->count())->toBe(2)
        ->and($next->context['findings'])->toContain('Important: the form has no label.')->toContain('lint: failure')
        ->and($thread->fresh()->only(['corrections', 'pending_findings', 'status']))->toBe(['corrections' => 2, 'pending_findings' => null, 'status' => 'open'])
        ->and($item->fresh()->state_id)->toBe($this->states['Todo']);

    // findings while the next correction runs, which pushes: dropped, the new commit is judged anew
    $run = $claim($this);
    $ci($this, $a, 'failure', 3_000_003, 'types');
    expect($thread->fresh()->pending_findings)->not->toBeNull();
    $finish($this, $run, ['commit' => $b]);
    expect($thread->fresh()->pending_findings)->toBeNull()->and(AgentRun::query()->where('type', 'correction')->count())->toBe(2);
    $pr($this, 'synchronize', $b);
    $ci($this, $b, 'success', 3_000_004);
    expect($heads('review'))->toBe([$a, $b]);
});

it('drops findings a failed run of the strand leaves behind, and findings of another head', function () use ($claim, $assign, $pr, $ci) {
    $item = WorkItem::factory()->for($this->project)->create(['state_id' => $this->states['Todo']]);
    $a = str_repeat('a', 40);
    $assign($this, $item, $this->kira);
    $task = $claim($this);
    $pr($this, 'opened', $a);
    $ci($this, $a, 'failure');
    $thread = AgentThread::query()->sole();
    expect($thread->fresh()->pending_findings['head'])->toBe($a)
        ->and(StartCorrection::run($this->system, $thread, 'ci', 'red at c', str_repeat('c', 40)))->toBeNull()
        ->and($thread->fresh()->pending_findings)->toMatchArray(['head' => str_repeat('c', 40), 'text' => 'red at c'])
        ->and(StartCorrection::run($this->system, $thread, 'comments', 'by hand', null))->not->toBeNull();

    $this->postJson("/api/runner/runs/{$task['id']}/result", ['attempt' => 1, 'status' => 'failed', 'error' => 'crashed'], AgentWorld::headers($this->token))->assertOk();
    expect($thread->fresh()->pending_findings)->toBeNull();
});

it('reads workflow runs and commit statuses as CI: a waiting run is no green, a failed status is red', function () use ($claim, $finish, $assign, $pr, $heads) {
    $item = WorkItem::factory()->for($this->project)->create(['state_id' => $this->states['Todo']]);
    $a = str_repeat('a', 40);
    $assign($this, $item, $this->kira);
    $task = $claim($this);
    $pr($this, 'opened', $a);
    $finish($this, $task, ['commit' => $a]);

    // a workflow waits for its concurrency group, without any check run: pending, no review
    $this->travel(3)->minutes();
    $this->github->workflowRuns[$a] = [['id' => 91, 'name' => 'CI', 'status' => 'waiting', 'conclusion' => null, 'html_url' => 'https://github.com/feldwerk/website/actions/runs/91'], ['id' => 'x', 'name' => 'Malformed']];
    expect(SweepAgentThreads::run($this->system))->toBe(1)->and($heads('review'))->toBe([])
        ->and(WorkItemLink::query()->sole()->ci())->toBe('pending')
        ->and(WorkItemLink::query()->sole()->checks->pluck('kind')->all())->toBe(['workflow']);

    // no delivery tells when it ends: the sweep asks again; it passed, a commit status fails
    $this->github->workflowRuns[$a] = [['id' => 91, 'name' => 'CI', 'status' => 'completed', 'conclusion' => 'success', 'html_url' => null]];
    $this->github->statuses[$a] = [['id' => 501, 'context' => 'ci/jenkins', 'state' => 'error', 'target_url' => 'https://ci.example.com/501']];
    expect(SweepAgentThreads::run($this->system))->toBe(0);
    $this->travel(3)->minutes();
    expect(SweepAgentThreads::run($this->system))->toBe(1)
        ->and(AgentRun::query()->where('type', 'correction')->sole()->context['findings'])->toContain('ci/jenkins: failure (https://ci.example.com/501)')
        ->and(WorkItemLink::query()->sole()->checks->sortBy('kind')->pluck('kind')->values()->all())->toBe(['status', 'workflow']);
});

it('merges nothing while a workflow run waits or a commit status is pending, though the check runs are green', function () use ($claim, $finish, $assign, $pr, $ci) {
    $item = WorkItem::factory()->for($this->project)->create(['state_id' => $this->states['Todo']]);
    $a = str_repeat('a', 40);
    $assign($this, $item, $this->kira);
    $task = $claim($this);
    $pr($this, 'opened', $a);
    $finish($this, $task, ['commit' => $a]);
    $ci($this, $a, 'success');
    $this->github->statuses[$a] = [['id' => 502, 'context' => 'deploy/preview', 'state' => 'pending', 'target_url' => null]];

    $finish($this, $claim($this), ['verdict' => 'approve', 'text' => 'Verdict: approve']);
    expect($this->github->merges)->toBe([])->and(AgentThread::query()->sole()->merge_sha)->toBeNull()
        ->and(WorkItemLink::query()->sole()->ci())->toBe('pending')
        ->and(AgentRun::query()->where('type', 'correction')->count())->toBe(0);

    // the status passes: the approve of the commit merges
    $this->github->statuses[$a] = [['id' => 502, 'context' => 'deploy/preview', 'state' => 'success', 'target_url' => null]];
    expect(ApproveAndMerge::run($this->system, AgentThread::query()->sole()))->toBeFalse();
    $this->travel(3)->minutes();
    SweepAgentThreads::run($this->system);
    expect($this->github->merges)->toBe([['number' => 12, 'sha' => $a, 'method' => 'squash']]);
});

it('sets no older head back from a delivery that comes late, and asks GitHub to merge a PR once', function () use ($claim, $finish, $assign, $pr) {
    $item = WorkItem::factory()->for($this->project)->create(['state_id' => $this->states['Todo']]);
    [$a, $b] = [str_repeat('a', 40), str_repeat('b', 40)];
    $assign($this, $item, $this->kira);
    $task = $claim($this);
    $pr($this, 'opened', $a);
    $pr($this, 'synchronize', $b, ['updated_at' => '2026-11-24T09:10:00Z']);
    $pr($this, 'synchronize', $a, ['updated_at' => '2026-11-24T09:05:00Z']);
    expect(AgentThread::query()->sole()->head_sha)->toBe($b);
    $finish($this, $task, ['commit' => $b]);

    $repository = ProjectRepository::query()->sole()->repository_id;
    $first = OwnMerges::expect($repository, 12);
    $this->travel(1)->minutes();
    $again = OwnMerges::expect($repository, 12);
    expect($again->id)->toBe($first->id)->and($again->started_at->gt($first->started_at))->toBeTrue();
    OwnMerges::merged($again, str_repeat('f', 40));
    expect(OwnMerges::expect($repository, 12)->id)->not->toBe($first->id);
});

it('leaves a strand that a person paused meanwhile to her when a run of it ends without a commit', function () {
    $sha = str_repeat('a', 40);
    $item = WorkItem::factory()->for($this->project)->create(['state_id' => $this->states['In Progress'], 'assignee_id' => $this->kira->id]);
    $thread = AgentThread::factory()->create(['bot_id' => $this->kira->id, 'project_id' => $this->project->id, 'work_item_id' => $item->id, 'status' => AgentThread::PAUSED,
        'pause_reason' => 'reassigned', 'repository_github_id' => 700_000_001, 'pr_number' => 12, 'head_sha' => $sha, 'branch' => 'agent/x',
        'pending_findings' => ['source' => 'ci', 'head' => $sha, 'text' => 'red']]);
    $run = AgentRun::factory()->type(RunType::Correction)->create(['bot_id' => $this->kira->id, 'project_id' => $this->project->id, 'work_item_id' => $item->id,
        'thread_id' => $thread->id, 'status' => RunStatus::Succeeded, 'finished_at' => now(), 'context' => ['start_head' => $sha], 'result' => []]);

    expect(HandleRunResult::run($this->system, $run))->toBe('nothing')
        ->and($thread->fresh()->only(['status', 'pause_reason', 'pending_findings']))->toBe(['status' => 'paused', 'pause_reason' => 'reassigned', 'pending_findings' => null])
        ->and(AgentRun::query()->count())->toBe(1);
});

it('sets an item back when a commit a run reported never reaches the PR', function () use ($claim, $finish, $assign, $pr, $ci) {
    $item = WorkItem::factory()->for($this->project)->create(['state_id' => $this->states['Todo']]);
    [$a, $b, $c] = [str_repeat('a', 40), str_repeat('b', 40), str_repeat('c', 40)];
    $assign($this, $item, $this->kira);
    $task = $claim($this);
    $pr($this, 'opened', $a);
    $finish($this, $task, ['commit' => $a]);
    $ci($this, $a, 'failure');

    // the correction reports a commit the PR never gets: the head waits for its webhook, the sweep looks after five minutes
    $finish($this, $claim($this), ['commit' => $b]);
    $thread = AgentThread::query()->sole();
    expect($thread->pushed_sha)->toBe($b)->and($item->fresh()->state_id)->toBe($this->states['Pending']);
    $this->travel(4)->minutes();
    expect(SweepAgentThreads::run($this->system))->toBe(0);
    $this->travel(2)->minutes();
    expect(SweepAgentThreads::run($this->system))->toBe(1)
        ->and($thread->fresh()->only(['pushed_sha', 'pushed_at']))->toBe(['pushed_sha' => null, 'pushed_at' => null])
        ->and($item->fresh()->state_id)->toBe($this->states['Todo'])
        ->and(Comment::query()->where('work_item_id', $item->id)->latest('id')->first()->body_text)->toContain('bbbbbbb')->toContain('not pushed')
        ->and(SweepAgentThreads::noPush($thread))->toBe(0);

    // a push that comes clears the wait
    $thread->forceFill(['pushed_sha' => $c, 'pushed_at' => now()])->save();
    $pr($this, 'synchronize', $c);
    expect($thread->fresh()->pushed_sha)->toBeNull();
});

it('asks GitHub again for the workflow runs of a head when a suite of GitHub Actions completes', function () use ($claim, $finish, $assign, $pr, $heads) {
    $item = WorkItem::factory()->for($this->project)->create(['state_id' => $this->states['Todo']]);
    $a = str_repeat('a', 40);
    $assign($this, $item, $this->kira);
    $task = $claim($this);
    $pr($this, 'opened', $a);
    $finish($this, $task, ['commit' => $a]);
    $this->travel(3)->minutes();
    $this->github->workflowRuns[$a] = [['id' => 91, 'name' => 'CI', 'status' => 'queued', 'conclusion' => null, 'html_url' => null]];
    SweepAgentThreads::run($this->system);
    expect(WorkItemLink::query()->sole()->ci())->toBe('pending');

    $this->github->workflowRuns[$a] = [['id' => 91, 'name' => 'CI', 'status' => 'completed', 'conclusion' => 'success', 'html_url' => null]];
    $calls = count($this->github->checkRunCalls);
    FakeGitHub::deliver($this, 'check_suite', FakeGitHub::checkSuite($a))->assertStatus(202);
    expect(count($this->github->checkRunCalls))->toBe($calls + 1)->and(WorkItemLink::query()->sole()->ci())->toBe('success')
        ->and($heads('review'))->toBe([$a]);

    // nothing waits any more: the next suite asks GitHub nothing
    FakeGitHub::deliver($this, 'check_suite', FakeGitHub::checkSuite($a))->assertStatus(202);
    expect(count($this->github->checkRunCalls))->toBe($calls + 1);
});
