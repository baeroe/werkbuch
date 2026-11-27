<?php

use App\Actions\Links\SyncChecks;
use App\Models\GitHubDelivery;
use App\Models\Project;
use App\Models\User;
use App\Models\WorkItem;
use App\Models\WorkItemLink;
use App\Support\Actor;
use Tests\Support\FakeGitHub;

/*
 * The check runs of a linked PR (spec 12, WEBU-25): per link and run, only of the head commit, a run that ended stays
 * ended; the CI state at the item comes from them.
 */

beforeEach(function () {
    $this->github = FakeGitHub::connected();
    $this->project = Project::factory()->create(['identifier' => 'WEBU']);
    FakeGitHub::link($this->project);
    $this->sha = str_repeat('a', 40);
    $this->link = WorkItemLink::factory()->create(['work_item_id' => WorkItem::factory()->for($this->project), 'head_sha' => $this->sha]);
});

it('keeps the runs of the head commit and reads the CI state from them', function () {
    FakeGitHub::deliver($this, 'check_run', FakeGitHub::checkRun($this->sha, 'in_progress'), 'c-1')->assertStatus(202);
    expect($this->link->load('checks')->ci())->toBe('pending')
        ->and(GitHubDelivery::query()->where('delivery_id', 'c-1')->value('outcome'))->toBe('ok');

    FakeGitHub::deliver($this, 'check_run', FakeGitHub::checkRun($this->sha, 'completed', 'success'))->assertStatus(202);
    FakeGitHub::deliver($this, 'check_run', FakeGitHub::checkRun($this->sha, 'completed', 'failure', 3_000_002, 'lint'))->assertStatus(202);

    $check = $this->link->checks()->where('check_run_id', 3_000_001)->sole();
    expect($check->only(['name', 'app', 'status', 'conclusion', 'url']))->toBe([
        'name' => 'tests', 'app' => 'GitHub Actions', 'status' => 'completed', 'conclusion' => 'success', 'url' => 'https://github.com/feldwerk/website/runs/3000001',
    ])->and($this->link->load('checks')->ci())->toBe('failure');
});

it('keeps a run that ended ended when a late delivery says it runs, and passes over another commit', function () {
    FakeGitHub::deliver($this, 'check_run', FakeGitHub::checkRun($this->sha, 'completed', 'success'))->assertStatus(202);
    FakeGitHub::deliver($this, 'check_run', FakeGitHub::checkRun($this->sha, 'in_progress'))->assertStatus(202);
    FakeGitHub::deliver($this, 'check_run', FakeGitHub::checkRun(str_repeat('f', 40), 'completed', 'failure', 3_000_003), 'c-other')->assertStatus(202);

    expect($this->link->checks()->sole()->status)->toBe('completed')
        ->and($this->link->load('checks')->ci())->toBe('success')
        ->and(GitHubDelivery::query()->where('delivery_id', 'c-other')->value('outcome'))->toBe('ignored')
        ->and(SyncChecks::run(Actor::system(User::defaultBot(), 'test'), ['check_run' => ['id' => 1]]))->toBe('ignored');
});

it('counts only the newest attempt of a check started again, and shows only it at the item (WEBU-62)', function () {
    FakeGitHub::deliver($this, 'check_run', FakeGitHub::checkRun($this->sha, 'completed', 'failure', 3_000_010, 'e2e'))->assertStatus(202);
    FakeGitHub::deliver($this, 'check_run', FakeGitHub::checkRun($this->sha, 'completed', 'success', 3_000_011, 'lint'))->assertStatus(202);
    expect($this->link->load('checks')->ci())->toBe('failure');

    // the job started again: same name, a higher id, green; the red attempt before no longer counts
    FakeGitHub::deliver($this, 'check_run', FakeGitHub::checkRun($this->sha, 'completed', 'success', 3_000_020, 'e2e'))->assertStatus(202);
    $link = $this->link->load('checks');
    expect($link->ci())->toBe('success')
        ->and(array_map(fn ($check) => [$check->name, $check->check_run_id], $link->headChecks()))->toBe([['e2e', 3_000_020], ['lint', 3_000_011]]);

    // and the other way round: a new attempt that fails is red again
    FakeGitHub::deliver($this, 'check_run', FakeGitHub::checkRun($this->sha, 'completed', 'failure', 3_000_030, 'lint'))->assertStatus(202);
    expect($this->link->load('checks')->ci())->toBe('failure');
});
