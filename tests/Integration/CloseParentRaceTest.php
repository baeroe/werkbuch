<?php

use App\Access\ProjectRole;
use App\Actions\WorkItems\TransitionWorkItem;
use App\Domain\Automations\AutomationKey;
use App\Events\EventType;
use App\Models\Automation;
use App\Models\Project;
use App\Models\User;
use App\Models\WorkItem;
use Illuminate\Database\QueryException;
use Tests\Support\RaceConnections;

/*
 * "Eltern schließen" under concurrency (spec 4.13, K25): a move of a child locks its parent after itself and then reads
 * the children of the parent under a shared lock. Two people closing the last two open children of an epic at once so
 * never both read the other child open: the second one waits for the first one's shared lock on its child (or, when
 * both lock their child first, one of them deadlocks and its transaction runs again) and then sees the first child
 * closed. The epic closes exactly once. `mariadb` holds its transaction open like a request in progress,
 * `mariadb_second` is the other request and gives up waiting for a lock after one second.
 */

beforeEach(fn () => RaceConnections::setUp());

afterEach(fn () => RaceConnections::tearDown());

/** WEB with Mara and Erik, Eltern schließen on, an epic with two open children and the ID of its Done state. */
$world = function (): array {
    $mara = User::factory()->create(['name' => 'Mara']);
    $erik = User::factory()->create(['name' => 'Erik']);
    $web = Project::factory()->identifier('WEB')->member($mara, ProjectRole::Admin)->member($erik, ProjectRole::Member)->create(['lead_id' => $mara->id]);
    Automation::factory()->for($web)->key(AutomationKey::CloseParent)->enabled()->create();
    $epic = WorkItem::factory()->for($web)->epic()->create(['created_by' => $mara->id]);
    [$first, $second] = WorkItem::factory()->childOf($epic)->inState('Todo')->count(2)->create(['created_by' => $mara->id]);
    $done = (string) $web->workflow()->firstOrFail()->states()->where('name', 'Done')->value('id');

    return [$mara, $erik, $epic, $first, $second, $done];
};

it('two people closing the last two children at once close the epic exactly once', function () use ($world) {
    [$mara, $erik, $epic, $first, $second, $done] = $world();

    RaceConnections::hold(fn () => TransitionWorkItem::run(actor($mara), $first, ['to_state_id' => $done]));

    // the first move read the other child under a shared lock: the second one waits for its own child, not the epic
    $waited = RaceConnections::second(fn () => TransitionWorkItem::run(actor($erik), $second, ['to_state_id' => $done]));
    RaceConnections::expectLockWait($waited, 'work_items');
    assert($waited instanceof QueryException);
    expect($waited->getBindings())->toContain($second->id);

    RaceConnections::release();
    RaceConnections::second(fn () => TransitionWorkItem::run(actor($erik), $second, ['to_state_id' => $done]));

    expect($first->fresh()?->state_id)->toBe($done)
        ->and($second->fresh()?->state_id)->toBe($done)
        ->and($epic->fresh()?->state_id)->toBe($done)
        ->and(eventsOf(EventType::WorkItemStateChanged, $epic))->toHaveCount(1)
        ->and(eventsOf(EventType::WorkItemStateChanged, $epic)->sole()->meta['on_behalf_of'])->toBe($erik->id);
});

it('lets the second one, on its way while the first one finishes, close the epic once', function () use ($world) {
    [$mara, $erik, $epic, $first, $second, $done] = $world();

    RaceConnections::hold(fn () => TransitionWorkItem::run(actor($mara), $first, ['to_state_id' => $done]));
    RaceConnections::releaseBeforeLock('work_items');
    RaceConnections::second(fn () => TransitionWorkItem::run(actor($erik), $second, ['to_state_id' => $done]));

    expect($epic->fresh()?->state_id)->toBe($done)
        ->and(eventsOf(EventType::WorkItemStateChanged, $epic))->toHaveCount(1);
});
