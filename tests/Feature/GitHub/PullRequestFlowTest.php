<?php

use App\Events\EventType;
use App\Models\GitHubDelivery;
use App\Models\Project;
use App\Models\User;
use App\Models\Workflow;
use App\Models\WorkItem;
use App\Models\WorkItemLink;
use Illuminate\Support\Str;
use Tests\Support\FakeGitHub;
use Tests\TestCase;

/*
 * The acceptance of WEBU-25 without GitHub: a PR of a person with `Fixes WEBU-n` as the sequence of recorded webhook
 * deliveries (opened as a draft, ready for review, a check run, merged) against the false GitHub: the link, „In
 * Review“, the comment at the PR, „Gemergt“; a second open PR holds the merge back.
 */

beforeEach(function () {
    $this->github = FakeGitHub::connected();
    $this->project = Project::factory()->create(['identifier' => 'WEBU', 'name' => 'werkbuch']);
    FakeGitHub::link($this->project);
    $workflow = Workflow::default();
    $this->states = $workflow->states->pluck('id', 'name');
    $workflow->forceFill(['agent_states' => [
        'working' => $this->states['In Progress'], 'review' => $this->states['Pending'], 'correction' => $this->states['Todo'], 'merged' => $this->states['Done'],
    ]])->save();
});

/** Delivers a recorded payload of tests/Support/github with the keys put in, and answers the outcome of the delivery. */
$replay = function (TestCase $test, string $event, string $file, array $keys): string {
    $text = (string) file_get_contents(base_path("tests/Support/github/{$file}.json"));
    $payload = json_decode(strtr($text, $keys), true, flags: JSON_THROW_ON_ERROR);
    $delivery = (string) Str::uuid();
    FakeGitHub::deliver($test, $event, $payload, $delivery)->assertStatus(202);

    return (string) GitHubDelivery::query()->where('delivery_id', $delivery)->value('outcome');
};

it('links a PR of a person, moves its item to review when it is ready and to merged with the merge, and comments at it', function () use ($replay) {
    $item = WorkItem::factory()->for($this->project)->create(['state_id' => $this->states['Todo']]);
    $inCode = WorkItem::factory()->for($this->project)->create(['state_id' => $this->states['Todo']]);
    $keys = ['{{KEY}}' => $item->key, '{{CODE_KEY}}' => $inCode->key];

    expect($replay($this, 'pull_request', 'pull_request.opened', $keys))->toBe('linked')
        ->and($item->fresh()->state_id)->toBe($this->states['Todo'])
        ->and(WorkItemLink::query()->sole()->only(['work_item_id', 'number', 'draft', 'closes', 'head_branch']))->toBe([
            'work_item_id' => $item->id, 'number' => 57, 'draft' => true, 'closes' => true, 'head_branch' => 'fix/phone-number',
        ])
        ->and($this->github->comments)->toHaveCount(1)
        ->and($this->github->comments[0]['body'])->toContain("[{$item->key}](")->not->toContain($inCode->key);

    expect($replay($this, 'pull_request', 'pull_request.ready_for_review', $keys))->toBe('linked')
        ->and($item->fresh()->state_id)->toBe($this->states['Pending']);

    expect($replay($this, 'check_run', 'check_run.completed', $keys))->toBe('ok');
    $this->actingAs(User::factory()->admin()->create())->getJson("/api/v1/work-items/{$item->key}?include=links")->assertOk()
        ->assertJsonPath('data.links.0.ci', 'success')->assertJsonPath('data.links.0.state', 'open');

    expect($replay($this, 'pull_request', 'pull_request.closed', $keys))->toBe('linked')
        ->and($item->fresh()->state_id)->toBe($this->states['Done'])
        ->and($item->fresh()->closed_at)->not->toBeNull()
        ->and(WorkItemLink::query()->sole()->state)->toBe('merged')
        ->and($this->github->comments)->toHaveCount(1)
        ->and(eventsOf(EventType::WorkItemLinkAdded, $item))->toHaveCount(1)
        ->and(eventsOf(EventType::WorkItemLinkMerged, $item))->toHaveCount(1)
        ->and(eventsOf(EventType::WorkItemStateChanged, $item))->toHaveCount(2);
});

it('keeps the item in review when another PR is still open at it', function () use ($replay) {
    $item = WorkItem::factory()->for($this->project)->create(['state_id' => $this->states['Todo']]);
    $keys = ['{{KEY}}' => $item->key, '{{CODE_KEY}}' => 'WEBU-999'];
    FakeGitHub::deliver($this, 'pull_request', FakeGitHub::pullRequest('opened', 58, ['draft' => true, 'body' => "Fixes {$item->key}"]))->assertStatus(202);

    $replay($this, 'pull_request', 'pull_request.opened', $keys);
    $replay($this, 'pull_request', 'pull_request.ready_for_review', $keys);
    $replay($this, 'pull_request', 'pull_request.closed', $keys);

    expect($item->fresh()->state_id)->toBe($this->states['Pending'])
        ->and($this->github->comments)->toHaveCount(2);
});
