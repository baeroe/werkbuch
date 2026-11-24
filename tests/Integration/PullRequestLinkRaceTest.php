<?php

use App\Actions\Links\SyncPullRequest;
use App\Events\EventType;
use App\Models\Project;
use App\Models\User;
use App\Models\Workflow;
use App\Models\WorkItem;
use App\Models\WorkItemLink;
use App\Support\Actor;
use Tests\Support\FakeGitHub;
use Tests\Support\RaceConnections;

/*
 * Deliveries of one repo go one at a time (WEBU-25, A549): the second waits at the repo row of the project, then reads
 * what the first left. Two PRs that close one item merge at once: only the later one, seeing the other merged, moves
 * the item, once.
 */

beforeEach(function () {
    RaceConnections::setUp();
    FakeGitHub::connected();
    $this->project = Project::factory()->create(['identifier' => 'WEBU']);
    FakeGitHub::link($this->project);
    $workflow = Workflow::default();
    $this->states = $workflow->states->pluck('id', 'name');
    $workflow->forceFill(['agent_states' => [
        'working' => $this->states['In Progress'], 'review' => $this->states['Pending'], 'correction' => $this->states['Todo'], 'merged' => $this->states['Done'],
    ]])->save();
});

afterEach(fn () => RaceConnections::tearDown());

$sync = fn (string $action, int $number, array $pr) => SyncPullRequest::run(Actor::system(User::defaultBot(), 'test'), FakeGitHub::pullRequest($action, $number, $pr));

it('lets a second delivery of the repo wait at its repo row', function () use ($sync) {
    $item = WorkItem::factory()->for($this->project)->create(['state_id' => $this->states['Todo']]);

    RaceConnections::hold(fn () => $sync('opened', 41, ['body' => "Refs {$item->key}"]));
    RaceConnections::expectLockWait(RaceConnections::second(fn () => $sync('opened', 42, ['body' => "Refs {$item->key}"])), 'project_repositories');
    RaceConnections::release();

    expect($sync('opened', 42, ['body' => "Refs {$item->key}"]))->toBe('linked')
        ->and(WorkItemLink::query()->where('work_item_id', $item->id)->count())->toBe(2);
});

it('merges an item once when the two PRs that close it are merged at the same time', function () use ($sync) {
    $item = WorkItem::factory()->for($this->project)->create(['state_id' => $this->states['In Progress']]);
    $sync('opened', 43, ['body' => "Fixes {$item->key}"]);
    $sync('opened', 44, ['body' => "Fixes {$item->key}"]);
    $merged = fn (int $number) => $sync('closed', $number, ['state' => 'closed', 'merged' => true, 'merged_at' => '2026-11-24T10:00:00Z', 'body' => "Fixes {$item->key}"]);

    // the first merge holds the repo row; the second commits it the moment it asks for the row, then sees it merged
    RaceConnections::hold(fn () => $merged(43));
    RaceConnections::releaseBeforeLock('project_repositories');
    $outcome = RaceConnections::second(fn () => $merged(44));

    expect($outcome instanceof Throwable ? $outcome->getMessage() : $outcome)->toBe('linked')
        ->and(WorkItem::query()->find($item->id)?->state_id)->toBe($this->states['Done'])
        ->and(eventsOf(EventType::WorkItemStateChanged, $item))->toHaveCount(1)
        ->and(WorkItemLink::query()->where('work_item_id', $item->id)->pluck('state')->unique()->values()->all())->toBe(['merged']);
});
