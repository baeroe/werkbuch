<?php

use App\Actions\Agents\HandleRunResult;
use App\Actions\Comments\AddComment;
use App\Actions\Comments\EditComment;
use App\Actions\WorkItems\UpdateWorkItem;
use App\Agents\AgentConsumer;
use App\Domain\Agents\RunStatus;
use App\Domain\Agents\RunType;
use App\Events\EventType;
use App\Models\AgentProjectSettings;
use App\Models\AgentRun;
use App\Models\AgentThread;
use App\Models\Comment;
use App\Models\Project;
use App\Models\ProjectRepository;
use App\Models\User;
use App\Models\Workflow;
use App\Models\WorkItem;
use App\Models\WorkItemLink;
use App\Support\Actor;
use App\Support\AgentFlow;
use App\Support\OwnMerges;
use Illuminate\Support\Facades\DB;
use Tests\Support\AgentWorld;
use Tests\Support\FakeGitHub;
use Tests\TestCase;

/*
 * The acceptance of WEBU-26 without Rafael (spec 14): the flow of an item assigned to an agent, played with a false
 * runner (claim and result over /api/runner/*) and a false GitHub (webhook deliveries, the API answered by FakeGitHub).
 * Every step goes through the events and the consumer of the agents as in the running system (the queue is sync).
 */

beforeEach(function () {
    consumers(AgentConsumer::class);
    $this->github = FakeGitHub::connected();
    $this->project = Project::factory()->create(['identifier' => 'WEBU', 'name' => 'werkbuch']);
    FakeGitHub::link($this->project);
    $workflow = Workflow::default();
    $this->states = $workflow->states->pluck('id', 'name');
    $workflow->forceFill(['agent_states' => [
        'working' => $this->states['In Progress'], 'review' => $this->states['Pending'], 'correction' => $this->states['Todo'], 'merged' => $this->states['Done'],
    ]])->save();
    $this->kira = AgentWorld::agent([$this->project]);
    [$this->runner, $this->token] = AgentWorld::runner();
    $this->mara = User::factory()->admin()->create(['name' => 'Mara']);
});

/** The runner of the test claims; the run it got (as an array of the protocol) or null. */
$claim = fn (TestCase $test): ?array => $test->postJson('/api/runner/claim', [], AgentWorld::headers($test->token))->assertOk()->json('run');

/** The runner reports the end of a run. */
$finish = fn (TestCase $test, array $run, array $result) => $test->postJson("/api/runner/runs/{$run['id']}/result", ['attempt' => $run['attempt'], 'status' => 'succeeded', ...$result], AgentWorld::headers($test->token))->assertOk();

/** A person gives the item to an account (the agent hears `bot.assigned`). */
$assign = fn (TestCase $test, WorkItem $item, User $to) => UpdateWorkItem::run(actor($test->mara), $item, ['assignee_id' => $to->id]);

/** A delivery of the PR of the agent: opened, a push (`synchronize`), closed; on the branch of the strand. */
$pr = function (TestCase $test, string $action, string $sha, array $more = [], int $number = 12): void {
    $thread = AgentThread::query()->latest('id')->firstOrFail();
    FakeGitHub::deliver($test, 'pull_request', FakeGitHub::pullRequest($action, $number, [
        'author' => 'feldwerk-werkbuch[bot]', 'title' => 'Change things', 'body' => 'Fixes',
        'head' => ['ref' => $thread->branch, 'sha' => $sha, 'label' => 'feldwerk:'.$thread->branch], ...$more,
    ]))->assertStatus(202);
    $test->github->pulls[$number] = ['head' => ['sha' => $sha, 'ref' => $thread->branch], 'draft' => $more['draft'] ?? false];
};

/** A check run of the CI at a commit. */
$ci = fn (TestCase $test, string $sha, string $conclusion, int $id = 3_000_001) => FakeGitHub::deliver($test, 'check_run', FakeGitHub::checkRun($sha, 'completed', $conclusion, $id))->assertStatus(202);

it('runs an item from assignment through a red CI, a correction, a green CI and a review to the merge', function () use ($claim, $finish, $assign, $pr, $ci) {
    $item = WorkItem::factory()->for($this->project)->create(['title' => 'Phone number in the footer', 'state_id' => $this->states['Todo']]);
    [$a, $b] = [str_repeat('a', 40), str_repeat('d', 40)];

    $assign($this, $item, $this->kira);
    $task = $claim($this);
    expect($task['type'])->toBe('task')
        ->and($task['item']['key'])->toBe($item->key)
        ->and($task['model'])->toBe('sonnet')->and($task['model_source'])->toBe('default')
        ->and($task['system_prompt'])->toContain('# Contract')->toContain('# Working rules of the organization')->toContain('Fixes <KEY>')
        ->and($task['prompt'])->toContain("Run `task` for the item {$item->key}")->toContain('agent/'.$item->key)
        ->and($item->fresh()->state_id)->toBe($this->states['In Progress']);

    // the agent opens its PR and ends the task
    $pr($this, 'opened', $a);
    $finish($this, $task, ['commit' => $a, 'summary' => 'Footer shows the phone number.']);
    expect($item->fresh()->state_id)->toBe($this->states['Pending'])
        ->and(AgentThread::query()->sole()->only(['pr_number', 'head_sha']))->toBe(['pr_number' => 12, 'head_sha' => $a]);

    // CI is red: a correction with the failed check, the item to „Korrektur“
    $ci($this, $a, 'failure');
    expect($item->fresh()->state_id)->toBe($this->states['Todo']);
    $correction = $claim($this);
    expect($correction['type'])->toBe('correction')
        ->and($correction['prompt'])->toContain('from ci')->toContain('tests: failure')
        ->and($item->fresh()->state_id)->toBe($this->states['In Progress']);
    $pr($this, 'synchronize', $b);
    $finish($this, $correction, ['commit' => $b, 'summary' => 'Fixed the test.']);
    expect($item->fresh()->state_id)->toBe($this->states['Pending']);

    // CI is green on the new head: a review with a fresh session
    $ci($this, $b, 'success', 3_000_002);
    $review = $claim($this);
    expect($review['type'])->toBe('review')->and($review['head_sha'])->toBe($b)->and($review['thread'])->toBeNull()
        ->and($review['prompt'])->toContain('#12')->toContain($b);
    $finish($this, $review, ['verdict' => 'approve', 'text' => "Verdict: approve\n\nMinor: a typo."]);

    // werkbuch merges at the head it decided on, the item is „Gemergt“
    expect($this->github->merges)->toBe([['number' => 12, 'sha' => $b, 'method' => 'squash']])
        ->and($item->fresh()->state_id)->toBe($this->states['Done'])
        ->and(AgentThread::query()->sole()->status)->toBe(AgentThread::MERGED)
        ->and($this->github->deletedBranches)->toBe([AgentThread::query()->sole()->branch])
        ->and(collect($this->github->comments)->pluck('body')->implode("\n"))->toContain('approve')
        ->and(Comment::query()->where('work_item_id', $item->id)->where('author_id', $this->kira->id)->count())->toBe(1)
        ->and(AgentRun::query()->orderBy('id')->pluck('type')->map->value->all())->toBe(['task', 'correction', 'review']);

    // GitHub tells of the merge and of its push: nothing twice, the guard stays quiet
    $pr($this, 'closed', $b, ['state' => 'closed', 'merged' => true, 'merged_at' => '2026-11-24T10:00:00Z']);
    FakeGitHub::deliver($this, 'push', FakeGitHub::push($this->github->mergeSha))->assertStatus(202);
    expect(eventsOf(EventType::WorkItemStateChanged, $item)->last()->changes['state_id']['new'])->toBe($this->states['Done'])
        ->and(OwnMerges::explain(ProjectRepository::query()->sole()->repository_id, $this->github->mergeSha))->toBe(OwnMerges::OWN)
        ->and(ProjectRepository::query()->sole()->guard_detected_at)->toBeNull();
});

it('runs a conflict before the review', function () use ($claim, $finish, $assign, $pr, $ci) {
    $item = WorkItem::factory()->for($this->project)->create(['state_id' => $this->states['Todo']]);
    [$a, $b] = [str_repeat('a', 40), str_repeat('e', 40)];
    $assign($this, $item, $this->kira);
    $task = $claim($this);
    $pr($this, 'opened', $a);
    $finish($this, $task, ['commit' => $a]);

    // someone pushes to main: GitHub says the PR conflicts, before CI is green
    $this->github->pulls[12] = ['head' => ['sha' => $a], 'mergeable' => false, 'mergeable_state' => 'dirty'];
    FakeGitHub::deliver($this, 'push', FakeGitHub::push(str_repeat('9', 40), 'main', 'mara-feldwerk'))->assertStatus(202);
    $ci($this, $a, 'success');

    $conflict = $claim($this);
    expect($conflict['type'])->toBe('conflict')->and($conflict['prompt'])->toContain('conflicts with its base branch `main`')
        ->and(AgentRun::query()->where('type', 'review')->count())->toBe(0)
        ->and(AgentThread::query()->sole()->conflicts)->toBe(1);

    $this->github->pulls[12] = ['head' => ['sha' => $b]];
    $pr($this, 'synchronize', $b);
    $finish($this, $conflict, ['commit' => $b]);
    $ci($this, $b, 'success', 3_000_002);
    expect($claim($this))->toMatchArray(['type' => 'review', 'head_sha' => $b]);
});

it('cancels a review when a push comes and an approve frees only its own commit', function () use ($claim, $finish, $assign, $pr, $ci) {
    $item = WorkItem::factory()->for($this->project)->create(['state_id' => $this->states['Todo']]);
    [$a, $b] = [str_repeat('a', 40), str_repeat('d', 40)];
    $assign($this, $item, $this->kira);
    $task = $claim($this);
    $pr($this, 'opened', $a);
    $finish($this, $task, ['commit' => $a]);
    $ci($this, $a, 'success');
    $review = $claim($this);

    // a push while the review runs: it is canceled, its approve frees nothing
    $pr($this, 'synchronize', $b);
    expect(AgentRun::query()->find($review['id'])->status)->toBe(RunStatus::Canceling);
    $this->postJson("/api/runner/runs/{$review['id']}/result", ['attempt' => 1, 'status' => 'canceled'], AgentWorld::headers($this->token))->assertOk();
    expect($this->github->merges)->toBe([])->and($item->fresh()->state_id)->toBe($this->states['Pending']);

    // an approve of the old commit that comes anyway merges nothing
    $old = AgentRun::factory()->type(RunType::Review)->create(['bot_id' => $this->kira->id, 'project_id' => $this->project->id, 'work_item_id' => $item->id,
        'thread_id' => AgentThread::query()->sole()->id, 'head_sha' => $a, 'repository_github_id' => 700_000_001, 'pr_number' => 12]);
    HandleRunResult::run(Actor::system(User::defaultBot(), 'test'), tap($old)->forceFill(['status' => RunStatus::Succeeded, 'finished_at' => now(), 'result' => ['verdict' => 'approve', 'text' => 'ok']])->save() ? $old : $old);
    expect($this->github->merges)->toBe([]);

    // the review of the new commit approves it: the merge is at B
    $ci($this, $b, 'success', 3_000_002);
    $finish($this, $claim($this), ['verdict' => 'approve', 'text' => 'Verdict: approve']);
    expect($this->github->merges)->toBe([['number' => 12, 'sha' => $b, 'method' => 'squash']]);
});

it('pauses the strand at the brake without ending it and the owner gets the item', function () use ($claim, $finish, $assign, $pr, $ci) {
    $this->kira->forceFill(['owner_id' => $this->mara->id])->save();
    $item = WorkItem::factory()->for($this->project)->create(['state_id' => $this->states['Todo']]);
    $assign($this, $item, $this->kira);
    $task = $claim($this);
    $pr($this, 'opened', str_repeat('0', 40));
    $finish($this, $task, []);

    foreach (['1', '2', '3'] as $round) {
        $sha = str_repeat($round, 40);
        $ci($this, $sha === str_repeat('1', 40) ? str_repeat('0', 40) : str_repeat((string) ($round - 1), 40), 'failure', (int) "300000{$round}");
        $finish($this, $claim($this), ['commit' => $sha]);
        $pr($this, 'synchronize', $sha);
    }

    // the fourth red CI is past the brake (3 corrections): the strand pauses, the owner has the item
    $ci($this, str_repeat('3', 40), 'failure', 3_000_009);
    $thread = AgentThread::query()->sole();
    expect($thread->only(['status', 'pause_reason', 'corrections']))->toBe(['status' => 'paused', 'pause_reason' => 'brake', 'corrections' => 3])
        ->and($claim($this))->toBeNull()
        ->and($item->fresh()->assignee_id)->toBe($this->kira->owner_id)
        ->and($item->fresh()->state_id)->toBe($this->states['Todo'])
        ->and(Comment::query()->where('work_item_id', $item->id)->latest('id')->first()->body_text)->toContain('tests: failure');
});

it('continues a paused strand when a person assigns the bot again', function () use ($claim, $assign, $pr) {
    $item = WorkItem::factory()->for($this->project)->create(['state_id' => $this->states['Todo']]);
    $assign($this, $item, $this->kira);
    $task = $claim($this);
    $pr($this, 'opened', str_repeat('a', 40));

    // Mara gives it to herself: the running task is canceled, the strand pauses, the PR stays
    $assign($this, $item, $this->mara);
    expect(AgentRun::query()->find($task['id'])->status)->toBe(RunStatus::Canceling)
        ->and(AgentThread::query()->sole()->only(['status', 'pause_reason', 'pr_number']))->toBe(['status' => 'paused', 'pause_reason' => 'reassigned', 'pr_number' => 12]);

    AddComment::run(actor($this->mara), $item, ['body' => 'Use the number of the office, not mine.']);
    $assign($this, $item, $this->kira);
    $this->postJson("/api/runner/runs/{$task['id']}/result", ['attempt' => 1, 'status' => 'canceled'], AgentWorld::headers($this->token))->assertOk();

    $correction = $claim($this);
    expect($correction['type'])->toBe('correction')->and($correction['prompt'])->toContain('Mara: Use the number of the office')
        ->and($correction['thread']['id'])->toBe(AgentThread::query()->sole()->id)
        ->and(AgentThread::query()->sole()->status)->toBe('open');
});

it('starts nothing for a comment of a bot or a change with the actor agent', function () {
    $item = WorkItem::factory()->for($this->project)->create(['state_id' => $this->states['Todo'], 'assignee_id' => $this->kira->id]);
    $other = AgentWorld::agent([$this->project], [], 'Otto');

    // a bot mentions the agent, a bot assigns it, the agent itself assigns: nothing
    AddComment::run(actor($other), $item, ['body' => "@{$this->kira->handle} what do you think?"]);
    UpdateWorkItem::run(actor($other), WorkItem::factory()->for($this->project)->create(), ['assignee_id' => $this->kira->id]);
    DB::transaction(fn () => AgentFlow::assign($this->kira, WorkItem::factory()->for($this->project)->create(), $this->kira->id));

    expect(AgentRun::query()->count())->toBe(0)->and(AgentThread::query()->count())->toBe(0);
});

it('starts nothing without the agent steps of the workflow', function () use ($assign) {
    Workflow::default()->forceFill(['agent_states' => null])->save();
    $item = WorkItem::factory()->for($this->project)->create();

    $assign($this, $item, $this->kira);

    expect(AgentRun::query()->count())->toBe(0)->and($item->fresh()->assignee_id)->toBe($this->kira->id);
});

it('answers a question by mention as a comment of the bot', function () use ($claim, $finish) {
    $item = WorkItem::factory()->for($this->project)->create();

    AddComment::run(actor($this->mara), $item, ['body' => "@{$this->kira->handle} where is the footer built?"]);
    $run = $claim($this);
    expect($run['type'])->toBe('comment')->and($run['prompt'])->toContain('Mara asked you')->toContain('where is the footer built?')
        ->and($run['git'])->not->toBeNull();

    $finish($this, $run, ['text' => 'In `resources/js/shell/Footer.tsx`.']);
    $answer = Comment::query()->where('work_item_id', $item->id)->where('author_id', $this->kira->id)->sole();
    expect($answer->body_text)->toBe('In resources/js/shell/Footer.tsx.')
        ->and(AgentRun::query()->count())->toBe(1);

    // an edit of the question asks nothing again
    $question = Comment::query()->where('author_id', $this->mara->id)->sole();
    EditComment::run(actor($this->mara), $question, ['body' => "@{$this->kira->handle} where is the footer built, please?"]);
    expect(AgentRun::query()->count())->toBe(1);
});

it('reviews the PR of a person, approves it on GitHub and neither corrects nor merges', function () use ($claim, $finish, $ci) {
    $reviewer = AgentWorld::agent([$this->project], [], 'Rita');
    AgentProjectSettings::factory()->create(['project_id' => $this->project->id, 'review_bot_id' => $reviewer->id]);
    $item = WorkItem::factory()->for($this->project)->create(['state_id' => $this->states['Todo']]);
    $sha = str_repeat('7', 40);

    FakeGitHub::deliver($this, 'pull_request', FakeGitHub::pullRequest('opened', 57, ['body' => "Fixes {$item->key}", 'head' => ['ref' => 'fix/footer', 'sha' => $sha]]))->assertStatus(202);
    $ci($this, $sha, 'success');
    $review = $claim($this);
    expect($review)->toMatchArray(['type' => 'review', 'head_sha' => $sha])->and($review['item']['key'])->toBe($item->key);

    $finish($this, $review, ['verdict' => 'approve', 'text' => 'Verdict: approve']);
    expect($this->github->reviews)->toHaveCount(1)->and($this->github->reviews[0])->toMatchArray(['number' => 57, 'sha' => $sha, 'event' => 'APPROVE'])
        ->and($this->github->merges)->toBe([])
        ->and(Comment::query()->where('work_item_id', $item->id)->where('author_id', $reviewer->id)->count())->toBe(1)
        ->and(WorkItemLink::query()->sole()->only(['review', 'review_sha']))->toBe(['review' => 'approve', 'review_sha' => $sha]);

    // findings on the next commit: a GitHub comment, no correction
    $next = str_repeat('8', 40);
    FakeGitHub::deliver($this, 'pull_request', FakeGitHub::pullRequest('synchronize', 57, ['body' => "Fixes {$item->key}", 'head' => ['ref' => 'fix/footer', 'sha' => $next], 'updated_at' => '2026-11-24T09:10:00Z']))->assertStatus(202);
    $ci($this, $next, 'success', 3_000_002);
    $finish($this, $claim($this), ['verdict' => 'changes', 'text' => "Verdict: changes\n\nImportant: no test."]);
    expect($this->github->reviews[1])->toMatchArray(['event' => 'COMMENT'])
        ->and(AgentRun::query()->where('type', 'correction')->count())->toBe(0);
});

it('reviews with the bot of the strand without a review agent and leaves PRs of persons then', function () use ($claim, $finish, $assign, $pr, $ci) {
    FakeGitHub::deliver($this, 'pull_request', FakeGitHub::pullRequest('opened', 57, ['head' => ['ref' => 'fix/x', 'sha' => str_repeat('7', 40)], 'body' => 'Fixes WEBU-1']))->assertStatus(202);
    WorkItem::factory()->for($this->project)->create();
    $ci($this, str_repeat('7', 40), 'success');
    expect($claim($this))->toBeNull();

    $item = WorkItem::factory()->for($this->project)->create(['state_id' => $this->states['Todo']]);
    $assign($this, $item, $this->kira);
    $task = $claim($this);
    $pr($this, 'opened', str_repeat('a', 40));
    $finish($this, $task, []);
    $ci($this, str_repeat('a', 40), 'success', 3_000_002);
    $review = $claim($this);
    expect(AgentRun::query()->find($review['id'])->bot_id)->toBe($this->kira->id)->and($review['thread'])->toBeNull();
});

it('works an epic by rule A and leaves the child of a person to her', function () use ($claim, $finish, $assign, $pr, $ci) {
    $epic = WorkItem::factory()->for($this->project)->epic()->create(['title' => 'Contact page', 'state_id' => $this->states['Todo']]);
    $form = WorkItem::factory()->for($this->project)->childOf($epic)->create(['title' => 'Form', 'state_id' => $this->states['Todo']]);
    $map = WorkItem::factory()->for($this->project)->childOf($epic)->create(['title' => 'Map', 'state_id' => $this->states['Todo']]);
    $copy = WorkItem::factory()->for($this->project)->childOf($epic)->create(['title' => 'Copy', 'state_id' => $this->states['Todo'], 'assignee_id' => $this->mara->id]);

    $assign($this, $epic, $this->kira);
    $first = $claim($this);
    expect($first['item']['key'])->toBe($form->key)->and($first['thread']['branch'])->toStartWith('agent/'.$epic->key)
        ->and($first['prompt'])->toContain("child of the epic {$epic->key}")->toContain('open a draft pull request')
        ->and($form->fresh()->assignee_id)->toBe($this->kira->id)
        ->and($epic->fresh()->state_id)->toBe($this->states['In Progress']);

    $pr($this, 'opened', str_repeat('a', 40), ['draft' => true]);
    $finish($this, $first, []);
    expect($form->fresh()->state_id)->toBe($this->states['Pending'])->and($epic->fresh()->state_id)->toBe($this->states['In Progress']);

    $second = $claim($this);
    expect($second['item']['key'])->toBe($map->key)->and($second['thread']['id'])->toBe($first['thread']['id'])
        ->and($second['prompt'])->toContain('Push to the draft pull request');
    $finish($this, $second, []);

    // the child of Mara is still open: the PR stays a draft, CI and review wait
    $ci($this, str_repeat('a', 40), 'success');
    expect($this->github->ready)->toBe([])->and($claim($this))->toBeNull();

    // Mara closes her child: werkbuch marks the PR ready
    UpdateWorkItem::run(actor($this->mara), $copy, ['state_id' => $this->states['Done']]);
    expect($this->github->ready)->toBe(['PR_fake12'])->and($epic->fresh()->state_id)->toBe($this->states['Pending']);

    // ready for review runs no CI again on GitHub: the green CI of the head counts now (A594)
    $pr($this, 'ready_for_review', str_repeat('a', 40), ['draft' => false]);
    $this->github->checkRuns[str_repeat('a', 40)] = [FakeGitHub::checkRun(str_repeat('a', 40), 'completed', 'success')['check_run']];
    $finish($this, $claim($this), ['verdict' => 'approve', 'text' => 'Verdict: approve']);

    expect($this->github->merges)->toHaveCount(1)
        ->and([$epic->fresh()->state_id, $form->fresh()->state_id, $map->fresh()->state_id])->toBe(array_fill(0, 3, $this->states['Done']))
        ->and($copy->fresh()->assignee_id)->toBe($this->mara->id);
});

it('picks up the work the guard held back once a project admin confirms', function () use ($claim, $finish, $assign, $pr) {
    $item = WorkItem::factory()->for($this->project)->create(['state_id' => $this->states['Todo']]);
    $assign($this, $item, $this->kira);
    $task = $claim($this);
    $pr($this, 'opened', str_repeat('a', 40));

    // the app pushes to main outside a merge of werkbuch: the guard stops the run and pauses the strand
    FakeGitHub::deliver($this, 'push', FakeGitHub::push(str_repeat('6', 40)))->assertStatus(202);
    $this->postJson("/api/runner/runs/{$task['id']}/result", ['attempt' => 1, 'status' => 'canceled'], AgentWorld::headers($this->token))->assertOk();
    $later = WorkItem::factory()->for($this->project)->create(['state_id' => $this->states['Todo']]);
    $assign($this, $later, $this->kira);
    expect(AgentThread::query()->where('work_item_id', $item->id)->sole()->status)->toBe('paused')->and($claim($this))->toBeNull();

    $this->actingAs($this->mara)->postJson('/api/v1/projects/WEBU/repository/confirm-guard')->assertOk();

    // one at a time (one place per repo): the correction of the strand first, then the task held back
    $first = $claim($this);
    $finish($this, $first, []);
    expect([$first['type'], $claim($this)['type']])->toBe(['correction', 'task'])
        ->and($first['prompt'])->toContain('from guard')
        // nothing to change after the guard: the head no review judged is looked at, the strand does not pause (A610)
        ->and(AgentThread::query()->where('work_item_id', $item->id)->sole()->only(['status', 'pause_reason']))->toBe(['status' => 'open', 'pause_reason' => null])
        ->and($item->fresh()->state_id)->toBe($this->states['Pending']);
});
