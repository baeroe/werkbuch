<?php

use App\Actions\Links\LoadChecks;
use App\Actions\Links\SyncChecks;
use App\Models\Project;
use App\Models\User;
use App\Models\WorkItem;
use App\Models\WorkItemLink;
use App\Support\Actor;
use Tests\Support\FakeGitHub;

/*
 * The checks of a link change without an event (WEBU-28, A648): `work_item.checks_changed` on the channel of the
 * project of the item, after the commit, once per item and delivery (or load), and only when a check row changed.
 */

beforeEach(function () {
    $this->github = FakeGitHub::connected();
    $this->project = Project::factory()->create(['identifier' => 'WEBU']);
    FakeGitHub::link($this->project);
    $this->sha = str_repeat('a', 40);
    $this->item = WorkItem::factory()->for($this->project)->create();
    $this->link = WorkItemLink::factory()->create(['work_item_id' => $this->item->id, 'head_sha' => $this->sha]);
    $this->system = Actor::system(User::defaultBot(), 'test');
    $this->broadcasts = broadcasts();
});

/** The checks messages sent so far: channel and payload. */
$told = fn () => collect(test()->broadcasts->sent())->where('event', 'live')->filter(fn (array $sent) => $sent['payload']['type'] === 'work_item.checks_changed')
    ->map(fn (array $sent) => ['channels' => $sent['channels'], 'payload' => $sent['payload']])->values()->all();

it('tells the project of the item when a delivery changes a check, and nothing when it changes none', function () use ($told) {
    FakeGitHub::deliver($this, 'check_run', FakeGitHub::checkRun($this->sha, 'in_progress'))->assertStatus(202);

    expect($told())->toBe([[
        'channels' => ["private-project.{$this->project->id}"],
        'payload' => [
            'event_id' => null, 'type' => 'work_item.checks_changed', 'project_id' => $this->project->id, 'page_id' => null,
            'template_id' => null, 'item_id' => $this->item->id, 'comment_id' => null, 'actor_id' => null,
        ],
    ]]);

    // the same run again, a late `in_progress` after `completed`, another commit: nothing changed, nothing told
    FakeGitHub::deliver($this, 'check_run', FakeGitHub::checkRun($this->sha, 'in_progress'))->assertStatus(202);
    FakeGitHub::deliver($this, 'check_run', FakeGitHub::checkRun($this->sha, 'completed', 'success'))->assertStatus(202);
    FakeGitHub::deliver($this, 'check_run', FakeGitHub::checkRun($this->sha, 'in_progress'))->assertStatus(202);
    FakeGitHub::deliver($this, 'check_run', FakeGitHub::checkRun(str_repeat('f', 40), 'completed', 'failure', 3_000_003))->assertStatus(202);
    expect($told())->toHaveCount(2);
});

it('tells an item once for its links of one commit', function () use ($told) {
    WorkItemLink::factory()->create(['work_item_id' => $this->item->id, 'head_sha' => $this->sha, 'number' => 99]);
    $other = WorkItem::factory()->for($this->project)->create();
    WorkItemLink::factory()->create(['work_item_id' => $other->id, 'head_sha' => $this->sha, 'number' => 98]);

    SyncChecks::run($this->system, FakeGitHub::checkRun($this->sha, 'completed', 'success'));

    expect(array_map(fn (array $sent) => $sent['payload']['item_id'], $told()))->toEqualCanonicalizing([$this->item->id, $other->id]);
});

it('tells once per load from GitHub, and only when the checks changed', function () use ($told) {
    $this->github->checkRuns[$this->sha] = [
        FakeGitHub::checkRun($this->sha, 'completed', 'success')['check_run'],
        FakeGitHub::checkRun($this->sha, 'completed', 'success', 3_000_002, 'lint')['check_run'],
    ];
    $this->github->workflowRuns[$this->sha] = [['id' => 51, 'name' => 'CI', 'status' => 'in_progress', 'conclusion' => null, 'html_url' => 'https://github.com/feldwerk/website/actions/runs/51']];

    LoadChecks::run($this->system, 700_000_001, $this->sha);
    expect($told())->toHaveCount(1);

    // the same answer again: nothing changed
    LoadChecks::run($this->system, 700_000_001, $this->sha);
    expect($told())->toHaveCount(1);

    // only the workflow run ended
    $this->github->workflowRuns[$this->sha][0] = [...$this->github->workflowRuns[$this->sha][0], 'status' => 'completed', 'conclusion' => 'success'];
    LoadChecks::run($this->system, 700_000_001, $this->sha);
    expect($told())->toHaveCount(2);

    // the workflow run is gone
    $this->github->workflowRuns[$this->sha] = [];
    LoadChecks::run($this->system, 700_000_001, $this->sha);
    expect($told())->toHaveCount(3);
});

it('tells nothing when the item and with it its link are gone', function () use ($told) {
    $this->item->delete();

    SyncChecks::run($this->system, FakeGitHub::checkRun($this->sha, 'completed', 'success'));

    expect($told())->toBe([]);
});
