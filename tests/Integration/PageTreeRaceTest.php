<?php

use App\Access\ProjectRole;
use App\Actions\Pages\MovePage;
use App\Events\EventType;
use App\Models\Page;
use App\Models\Project;
use App\Models\User;
use Illuminate\Validation\ValidationException;
use Tests\Support\RaceConnections;

/*
 * Two moves of one wiki at the same time (Review Focus „Baum ohne Zyklen“): MovePage checks for a cycle under the tree
 * lock (PageLock::tree, the project `for update`) against the tree as it is then. So the second move waits for the
 * first and sees the place the first one left, never a loop of pages that falls out of the tree. `mariadb` holds its
 * transaction open like a request in progress, `mariadb_second` is the other request and gives up waiting for a lock
 * after one second.
 */

beforeEach(fn () => RaceConnections::setUp());

afterEach(fn () => RaceConnections::tearDown());

/** WEB with Mara as its admin, Erik as a member and the pages A and B at the top. */
$world = function (): array {
    $mara = User::factory()->create(['name' => 'Mara']);
    $web = Project::factory()->identifier('WEB')->member($mara, ProjectRole::Admin)->create(['lead_id' => $mara->id]);
    $erik = memberOf($web, ProjectRole::Member, ['name' => 'Erik']);
    $a = Page::factory()->create(['project_id' => $web->id, 'title' => 'A', 'created_by' => $mara->id]);
    $b = Page::factory()->create(['project_id' => $web->id, 'title' => 'B', 'created_by' => $mara->id]);

    return [$a, $b, $mara, $erik];
};

it('makes a second move in the wiki wait for the first', function () use ($world) {
    [$a, $b, $mara, $erik] = $world();

    RaceConnections::hold(fn () => MovePage::run(actor($mara), $a, ['parent_id' => $b->id, 'before_id' => null]));

    RaceConnections::expectLockWait(RaceConnections::second(fn () => MovePage::run(actor($erik), Page::query()->findOrFail($b->id), ['parent_id' => $a->id, 'before_id' => null])), 'projects');

    RaceConnections::release();

    expect($a->fresh()?->parent_id)->toBe($b->id);
});

it('two moves that would put A under B and B under A give one move and one cycle refusal', function () use ($world) {
    [$a, $b, $mara, $erik] = $world();

    RaceConnections::hold(fn () => MovePage::run(actor($mara), $a, ['parent_id' => $b->id, 'before_id' => null]));
    RaceConnections::releaseBeforeLock('projects');

    $second = RaceConnections::second(fn () => MovePage::run(actor($erik), Page::query()->findOrFail($b->id), ['parent_id' => $a->id, 'before_id' => null]));

    expect($second)->toBeInstanceOf(ValidationException::class);
    assert($second instanceof ValidationException);
    expect($second->errors())->toBe(['parent_id' => [__('field.parent_page.cycle')]])
        ->and($a->fresh()?->parent_id)->toBe($b->id)
        ->and($b->fresh()?->parent_id)->toBeNull()
        ->and(eventsOf(EventType::PageMoved))->toHaveCount(1);
});
