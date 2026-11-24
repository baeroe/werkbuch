<?php

use App\Actions\WorkItems\UpdateWorkItem;
use App\Agents\AgentConsumer;
use App\Events\EventType;
use App\Models\AgentRun;
use App\Models\AgentThread;
use App\Models\Comment;
use App\Models\Project;
use App\Models\ProjectRepository;
use App\Models\User;
use App\Models\Workflow;
use App\Models\WorkItem;
use App\Support\OwnMerges;
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
