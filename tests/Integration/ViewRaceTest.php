<?php

use App\Actions\Favorites\ToggleFavorite;
use App\Actions\Views\DeleteView;
use App\Actions\Views\SaveView;
use App\Events\EventType;
use App\Exceptions\Problem;
use App\Models\Favorite;
use App\Models\User;
use App\Models\View;
use Tests\Support\RaceConnections;

/*
 * Changes, deletions and favorites of one view at the same time (Task 6): SaveView and DeleteView read the row of the
 * view afresh under `lockForUpdate`, ToggleFavorite under a shared lock after the own account's row. A change or a
 * favorite waits for a deletion and then finds the view gone; a second change waits for the first and compares with
 * what that one left (K6: `PUT` replaces a view as a whole, so the second input wins in full). `mariadb` holds its
 * transaction open like a request in progress, `mariadb_second` is the other request and gives up waiting for a lock
 * after one second.
 */

beforeEach(fn () => RaceConnections::setUp());

afterEach(fn () => RaceConnections::tearDown());

/** A whole view input under the name and icon given. */
$input = fn (string $name, string $icon): array => [
    'name' => $name,
    'icon' => $icon,
    'filter' => ['version' => 1, 'conditions' => []],
    'display' => ['layout' => 'list', 'group_by' => 'none', 'sort' => ['field' => 'rank', 'direction' => 'asc'], 'fields' => ['key', 'title'], 'show_sub_items' => true],
];

it('makes a change wait for a running deletion and answers 404', function () use ($input) {
    $ida = User::factory()->create();
    $view = View::factory()->create(['created_by' => $ida->id, 'name' => 'Bugs', 'icon' => 'bug']);

    RaceConnections::hold(fn () => DeleteView::run(actor($ida), $view));

    RaceConnections::expectLockWait(RaceConnections::second(fn () => SaveView::run(actor($ida), $input('Neu', 'bug'), $view)), 'views');

    RaceConnections::releaseBeforeLock('views');
    $outcome = RaceConnections::second(fn () => SaveView::run(actor($ida), $input('Neu', 'bug'), $view));

    expect($outcome)->toBeInstanceOf(Problem::class)
        ->and($outcome instanceof Problem ? $outcome->status : null)->toBe(404)
        ->and(View::query()->count())->toBe(0)
        ->and(eventsOf(EventType::ViewUpdated)->count())->toBe(0);
});

it('leaves no favorite of a view deleted meanwhile', function () {
    $ida = User::factory()->create();
    $lene = User::factory()->create();
    $view = View::factory()->create(['created_by' => $ida->id]);

    RaceConnections::hold(fn () => DeleteView::run(actor($ida), $view));

    RaceConnections::expectLockWait(
        RaceConnections::second(fn () => ToggleFavorite::run(actor($lene), ['kind' => 'view', 'id' => $view->id])),
        'views',
        sqlEnd: 'lock in share mode',
    );

    // the view is found before the deletion commits, the shared lock after it finds it gone
    RaceConnections::releaseBeforeLock('views', 'lock in share mode');
    $outcome = RaceConnections::second(fn () => ToggleFavorite::run(actor($lene), ['kind' => 'view', 'id' => $view->id]));

    expect($outcome)->toBeInstanceOf(Problem::class)
        ->and($outcome instanceof Problem ? $outcome->status : null)->toBe(404)
        ->and(Favorite::query()->count())->toBe(0)
        ->and(eventsOf(EventType::FavoriteAdded)->count())->toBe(0);
});

it('lets the second of two changes see the first', function () use ($input) {
    $ida = User::factory()->create();
    $view = View::factory()->create(['created_by' => $ida->id, ...$input('Bugs', 'bug')]);

    RaceConnections::hold(fn () => SaveView::run(actor($ida), $input('A', 'bug'), $view));

    RaceConnections::expectLockWait(RaceConnections::second(fn () => SaveView::run(actor($ida), $input('Bugs', 'flag'), $view)), 'views');

    RaceConnections::releaseBeforeLock('views');
    $second = RaceConnections::second(fn () => SaveView::run(actor($ida), $input('Bugs', 'flag'), $view));

    expect($second)->toBeInstanceOf(View::class);

    $saved = View::query()->findOrFail($view->id);
    $events = eventsOf(EventType::ViewUpdated, $view);

    expect($saved->name)->toBe('Bugs')
        ->and($saved->icon)->toBe('flag')
        ->and($events->pluck('changes')->all())->toBe([
            ['name' => ['old' => 'Bugs', 'new' => 'A']],
            // compared with what the first left, not with what the second read before its lock
            ['name' => ['old' => 'A', 'new' => 'Bugs'], 'icon' => ['old' => 'bug', 'new' => 'flag']],
        ]);
});
