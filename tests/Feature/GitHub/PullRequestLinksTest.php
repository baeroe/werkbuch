<?php

use App\Access\ProjectRole;
use App\Actions\Links\SyncPullRequest;
use App\Actions\Workflows\SaveWorkflow;
use App\Events\EventType;
use App\Models\AgentThread;
use App\Models\Comment;
use App\Models\GitHubDelivery;
use App\Models\Notification;
use App\Models\Project;
use App\Models\ProjectIdentifier;
use App\Models\User;
use App\Models\Workflow;
use App\Models\WorkItem;
use App\Models\WorkItemLink;
use App\Notifications\NotificationConsumer;
use App\Support\Actor;
use Tests\Support\FakeGitHub;
use Tests\Support\Mcp\McpClient;
use Tests\Support\WorkflowFixtures;
use Tests\TestCase;

/*
 * PR links (spec 12, WEBU-25): a PR of the repo of a project links to the items it names, a PR of a person moves them
 * along the steps of the agents of the workflow (draft nothing, ready → In Review, merged with a closing word →
 * Gemergt only without another open PR), werkbuch comments once at the PR, the item records it.
 */

beforeEach(function () {
    $this->github = FakeGitHub::connected();
    $this->project = Project::factory()->create(['identifier' => 'WEBU', 'name' => 'werkbuch']);
    FakeGitHub::link($this->project);
    $workflow = Workflow::default();
    $ids = $workflow->states->pluck('id', 'name');
    $workflow->forceFill(['agent_states' => ['working' => $ids['In Progress'], 'review' => $ids['Pending'], 'correction' => $ids['Todo'], 'merged' => $ids['Done']]])->save();
    $this->states = $ids;
});

/** An item of the project WEBU in a state of the standard workflow, by name. */
$item = fn (TestCase $test, string $state = 'Backlog') => WorkItem::factory()->for($test->project)->create(['state_id' => $test->states[$state]]);

/** Delivers a `pull_request` event and answers the outcome it left on its delivery. */
$deliver = function (TestCase $test, string $action, int $number, array $pr = []): string {
    $delivery = 'pr-'.uniqid();
    FakeGitHub::deliver($test, 'pull_request', FakeGitHub::pullRequest($action, $number, $pr), $delivery)->assertStatus(202);

    return (string) GitHubDelivery::query()->where('delivery_id', $delivery)->value('outcome');
};

$stateOf = fn (TestCase $test, WorkItem $item) => array_flip($test->states->all())[$item->fresh()->state_id];

it('links a draft without moving anything, moves to review when ready and to merged with the merge', function () use ($item, $deliver, $stateOf) {
    $webu = $item($this, 'Todo');

    expect($deliver($this, 'opened', 41, ['draft' => true, 'body' => "Fixes WEBU-{$webu->number}"]))->toBe('linked')
        ->and($stateOf($this, $webu))->toBe('Todo');

    $link = WorkItemLink::query()->sole();
    expect($link->only(['work_item_id', 'repository', 'number', 'state', 'draft', 'closes', 'author', 'head_branch', 'base_branch']))->toBe([
        'work_item_id' => $webu->id, 'repository' => 'feldwerk/website', 'number' => 41, 'state' => 'open', 'draft' => true, 'closes' => true,
        'author' => 'mara-feldwerk', 'head_branch' => 'feature-41', 'base_branch' => 'main',
    ])->and(eventsOf(EventType::WorkItemLinkAdded, $webu)->sole()->changes['pull_request']['new'])->toMatchArray(['number' => 41, 'closes' => true, 'draft' => true]);

    expect($deliver($this, 'ready_for_review', 41, ['body' => "Fixes WEBU-{$webu->number}"]))->toBe('linked')
        ->and($stateOf($this, $webu))->toBe('Pending')
        ->and(eventsOf(EventType::WorkItemStateChanged, $webu)->sole()->meta['reason'])->toBe(SyncPullRequest::REASON)
        ->and(eventsOf(EventType::WorkItemStateChanged, $webu)->sole()->actor_id)->toBe(User::defaultBot()->id);

    expect($deliver($this, 'closed', 41, ['state' => 'closed', 'merged' => true, 'merged_at' => '2026-11-24T10:00:00Z', 'closed_at' => '2026-11-24T10:00:00Z', 'body' => "Fixes WEBU-{$webu->number}"]))->toBe('linked')
        ->and($stateOf($this, $webu))->toBe('Done')
        ->and(WorkItemLink::query()->sole()->state)->toBe('merged')
        ->and(eventsOf(EventType::WorkItemLinkMerged, $webu)->sole()->changes['pull_request'])->toMatchArray([
            'old' => ['repository' => 'feldwerk/website', 'number' => 41, 'title' => 'Change things', 'url' => 'https://github.com/feldwerk/website/pull/41', 'state' => 'open', 'draft' => false, 'closes' => true],
        ])
        ->and(eventsOf(EventType::WorkItemLinkAdded, $webu))->toHaveCount(1);
});

it('moves only from backlog or unstarted to review and leaves started and closed items', function () use ($item, $deliver, $stateOf) {
    $backlog = $item($this, 'Backlog');
    $started = $item($this, 'In Progress');
    $done = $item($this, 'Done');

    $deliver($this, 'opened', 5, ['body' => "Refs WEBU-{$backlog->number}, WEBU-{$started->number} and WEBU-{$done->number}"]);

    expect([$stateOf($this, $backlog), $stateOf($this, $started), $stateOf($this, $done)])->toBe(['Pending', 'In Progress', 'Done'])
        ->and(WorkItemLink::query()->count())->toBe(3);
});

it('merges an item only when the PR closes it, into the base branch, and no other PR is open at it', function () use ($item, $deliver, $stateOf) {
    $closed = $item($this, 'In Progress');
    $other = $item($this, 'In Progress');
    $linked = $item($this, 'In Progress');
    $canceled = $item($this, 'Cancelled');

    $deliver($this, 'opened', 7, ['body' => "Fixes WEBU-{$closed->number}, WEBU-{$other->number} and WEBU-{$canceled->number}. Part of WEBU-{$linked->number}"]);
    // a second PR, still a draft, at one of the items
    $deliver($this, 'opened', 8, ['draft' => true, 'body' => "fixes WEBU-{$other->number}"]);

    $merged = ['state' => 'closed', 'merged' => true, 'merged_at' => '2026-11-24T10:00:00Z', 'body' => "Fixes WEBU-{$closed->number}, WEBU-{$other->number} and WEBU-{$canceled->number}. Part of WEBU-{$linked->number}"];
    $deliver($this, 'closed', 7, $merged);

    expect([$stateOf($this, $closed), $stateOf($this, $other), $stateOf($this, $linked), $stateOf($this, $canceled)])->toBe(['Done', 'In Progress', 'In Progress', 'Cancelled']);

    // the second one merged as well: nothing open any more
    $deliver($this, 'closed', 8, ['state' => 'closed', 'merged' => true, 'merged_at' => '2026-11-24T11:00:00Z', 'body' => "fixes WEBU-{$other->number}"]);
    expect($stateOf($this, $other))->toBe('Done');
});

it('leaves the state for a PR closed without merge and for a merge into another branch', function () use ($item, $deliver, $stateOf) {
    $a = $item($this, 'In Progress');
    $b = $item($this, 'In Progress');

    $deliver($this, 'closed', 9, ['state' => 'closed', 'closed_at' => '2026-11-24T10:00:00Z', 'body' => "Fixes WEBU-{$a->number}"]);
    $deliver($this, 'closed', 10, ['state' => 'closed', 'merged' => true, 'merged_at' => '2026-11-24T10:00:00Z', 'base' => ['ref' => 'develop', 'sha' => str_repeat('c', 40)], 'body' => "Fixes WEBU-{$b->number}"]);

    expect([$stateOf($this, $a), $stateOf($this, $b)])->toBe(['In Progress', 'In Progress'])
        ->and(WorkItemLink::query()->where('number', 9)->value('state'))->toBe('closed')
        ->and(WorkItemLink::query()->where('number', 10)->value('state'))->toBe('merged');
});

it('takes a link back with skip, also one of the branch, and keeps one whose key is gone otherwise', function () use ($item, $deliver) {
    $a = $item($this);
    $b = $item($this);

    $deliver($this, 'opened', 11, ['body' => "skip WEBU-{$a->number}", 'head' => ['ref' => "feat/webu-{$a->number}-x", 'sha' => str_repeat('b', 40)]]);
    expect(WorkItemLink::query()->exists())->toBeFalse();

    $deliver($this, 'opened', 12, ['body' => "Fixes WEBU-{$b->number}"]);
    $deliver($this, 'edited', 12, ['body' => 'Nothing to say any more.']);
    expect(WorkItemLink::query()->sole()->closes)->toBeTrue();

    $deliver($this, 'edited', 12, ['body' => "Ignore WEBU-{$b->number}"]);
    expect(WorkItemLink::query()->exists())->toBeFalse()
        ->and(eventsOf(EventType::WorkItemLinkRemoved, $b)->sole()->changes['pull_request']['old']['number'])->toBe(12);
});

it('reads no word or key in code, no key of another project and a former identifier of its own', function () use ($item, $deliver) {
    $a = $item($this);
    $b = $item($this);
    $ops = Project::factory()->create(['identifier' => 'OPS']);
    WorkItem::factory()->for($ops)->create();
    ProjectIdentifier::query()->create(['project_id' => $this->project->id, 'identifier' => 'OLD']);

    $deliver($this, 'opened', 13, ['title' => "Change `WEBU-{$a->number}`", 'body' => "```\nFixes WEBU-{$a->number}\n```\nFixes OPS-1 and closes old-{$b->number}"]);

    expect(WorkItemLink::query()->pluck('work_item_id')->all())->toBe([$b->id])
        ->and(WorkItemLink::query()->sole()->closes)->toBeTrue();
});

it('only links when the workflow does not name every step, or the item or project is archived', function () use ($item, $deliver, $stateOf) {
    $archived = $item($this, 'Done');
    $archived->forceFill(['archived_at' => now()])->save();
    $open = $item($this, 'Todo');

    $deliver($this, 'opened', 14, ['body' => "Fixes WEBU-{$archived->number} and WEBU-{$open->number}"]);
    expect($stateOf($this, $open))->toBe('Pending')->and(WorkItemLink::query()->count())->toBe(2);

    $workflow = Workflow::default();
    $workflow->forceFill(['agent_states' => [...$workflow->agentStates(), 'merged' => null]])->save();
    $later = $item($this, 'Todo');
    $deliver($this, 'opened', 15, ['body' => "Fixes WEBU-{$later->number}"]);
    expect($stateOf($this, $later))->toBe('Todo');

    $workflow->forceFill(['agent_states' => [...$workflow->agentStates(), 'merged' => $this->states['Done']]])->save();
    $this->project->forceFill(['archived_at' => now()])->save();
    $last = $item($this, 'Todo');
    $deliver($this, 'opened', 16, ['body' => "Fixes WEBU-{$last->number}"]);
    expect($stateOf($this, $last))->toBe('Todo')->and(WorkItemLink::query()->where('number', 16)->exists())->toBeTrue();
});

it('leaves the state when the workflow does not allow the move and says so at the item', function () {
    $actor = actor(User::factory()->admin()->create());
    $input = WorkflowFixtures::agencyInput('Streng');
    $input['agent_states'] = ['working' => 'app_progress', 'review' => 'app_review', 'correction' => 'app_todo', 'merged' => 'app_done'];
    $workflow = SaveWorkflow::run($actor, null, $input);
    $this->project->forceFill(['workflow_id' => $workflow->id])->save();
    $backlog = WorkItem::factory()->for($this->project)->create(['state_id' => $workflow->initial_state_id]);

    FakeGitHub::deliver($this, 'pull_request', FakeGitHub::pullRequest('opened', 17, ['body' => "Fixes WEBU-{$backlog->number}"]))->assertStatus(202);

    $comment = Comment::query()->where('work_item_id', $backlog->id)->sole();
    expect($backlog->fresh()->state_id)->toBe($workflow->initial_state_id)
        ->and($comment->author_id)->toBe(User::defaultBot()->id)
        ->and($comment->body_text)->toContain('feldwerk/website#17')->toContain('Review')->toContain('Backlog');
});

it('links a PR of an agent with its strand and leaves what it sets off to the flow', function () use ($item, $deliver, $stateOf) {
    $a = $item($this, 'Todo');
    $b = $item($this, 'Todo');
    $thread = AgentThread::factory()->create(['project_id' => $this->project->id, 'work_item_id' => $b->id, 'branch' => "agent/WEBU-{$b->number}-thing"]);

    expect($deliver($this, 'opened', 18, ['author' => 'feldwerk-werkbuch[bot]', 'body' => "Fixes WEBU-{$a->number}"]))->toBe('agent')
        ->and($deliver($this, 'opened', 19, ['body' => "Fixes WEBU-{$b->number}", 'head' => ['ref' => "agent/WEBU-{$b->number}-thing", 'sha' => str_repeat('d', 40)]]))->toBe('agent')
        ->and([$stateOf($this, $a), $stateOf($this, $b)])->toBe(['Todo', 'Todo'])
        ->and(WorkItemLink::query()->where('number', 19)->value('thread_id'))->toBe($thread->id)
        ->and($this->github->comments)->toBe([]);
});

it('ignores a PR of a repo of no project and a project in deletion', function () use ($item, $deliver) {
    $a = $item($this);

    expect(SyncPullRequest::run(Actor::system(User::defaultBot(), 'test'), FakeGitHub::pullRequest('opened', 20, ['body' => "Fixes WEBU-{$a->number}"], 700_000_099, 'feldwerk/other')))->toBe('ignored')
        ->and(SyncPullRequest::run(Actor::system(User::defaultBot(), 'test'), ['pull_request' => ['number' => 1]]))->toBe('ignored');

    $this->project->forceFill(['deleting_at' => now()])->save();
    expect($deliver($this, 'opened', 21, ['body' => "Fixes WEBU-{$a->number}"]))->toBe('ignored')
        ->and(WorkItemLink::query()->exists())->toBeFalse();
});

it('drops the checks of the commit before when the PR gets a new head', function () use ($item, $deliver) {
    $a = $item($this);
    $deliver($this, 'opened', 22, ['body' => "Refs WEBU-{$a->number}"]);
    FakeGitHub::deliver($this, 'check_run', FakeGitHub::checkRun(str_repeat('b', 40), 'completed', 'success'))->assertStatus(202);
    expect(WorkItemLink::query()->sole()->checks()->count())->toBe(1);

    $deliver($this, 'synchronize', 22, ['body' => "Refs WEBU-{$a->number}", 'head' => ['ref' => 'feature-22', 'sha' => str_repeat('e', 40)]]);
    expect(WorkItemLink::query()->sole()->checks()->count())->toBe(0)
        ->and(WorkItemLink::query()->sole()->head_sha)->toBe(str_repeat('e', 40));
});

it('tells the watchers of an item that a PR was linked and merged', function () use ($item, $deliver) {
    consumers(NotificationConsumer::class);
    $lene = memberOf($this->project, ProjectRole::Member);
    $a = $item($this, 'In Progress');
    $a->subscriptions()->create(['user_id' => $lene->id, 'reason' => 'manual']);

    $deliver($this, 'opened', 23, ['body' => "Refs WEBU-{$a->number}"]);

    $notification = Notification::query()->where('user_id', $lene->id)->sole();
    expect($notification->kind->value)->toBe('item_changed')
        ->and($notification->data)->toBe(['fields' => ['pull_request']]);
});

it('answers the links of an item with their checks over REST and MCP', function () use ($item, $deliver) {
    $a = $item($this, 'Todo');
    $deliver($this, 'opened', 24, ['title' => 'Link PRs', 'body' => "Fixes WEBU-{$a->number}"]);
    FakeGitHub::deliver($this, 'check_run', FakeGitHub::checkRun(str_repeat('b', 40), 'completed', 'success'))->assertStatus(202);
    $mara = memberOf($this->project, ProjectRole::Member);

    $response = $this->actingAs($mara)->getJson("/api/v1/work-items/WEBU-{$a->number}?include=links")->assertOk();
    expect($response->json('data.links'))->toHaveCount(1)
        ->and($response->json('data.links.0'))->toMatchArray([
            'repository' => 'feldwerk/website', 'number' => 24, 'title' => 'Link PRs', 'url' => 'https://github.com/feldwerk/website/pull/24',
            'state' => 'open', 'draft' => false, 'closes' => true, 'author' => 'mara-feldwerk', 'thread_id' => null, 'review' => null, 'ci' => 'success',
            'checks' => [['name' => 'tests', 'app' => 'GitHub Actions', 'status' => 'completed', 'conclusion' => 'success', 'url' => 'https://github.com/feldwerk/website/runs/3000001']],
        ]);

    $this->actingAs($mara)->getJson("/api/v1/work-items/WEBU-{$a->number}")->assertOk()->assertJsonMissingPath('data.links');

    $mcp = McpClient::for($this, apiToken($mara, ['read', 'mcp']));
    $answer = $mcp->call('work-items', ['action' => 'get', 'item' => "WEBU-{$a->number}", 'include' => ['links']]);
    expect($answer['structuredContent']['data']['links'][0]['number'])->toBe(24);
});
