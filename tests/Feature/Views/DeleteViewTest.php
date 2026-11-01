<?php

use App\Actions\Favorites\ToggleFavorite;
use App\Actions\Views\DeleteView;
use App\Events\EventType;
use App\Models\Favorite;
use App\Models\Project;
use App\Models\User;
use App\Models\View;

it('deletes the view with the favorites of every person', function () {
    $ida = User::factory()->create();
    $lene = User::factory()->create();
    $view = View::factory()->create(['created_by' => $ida->id, 'name' => 'Bugs in Produktion']);
    $other = View::factory()->create(['created_by' => $ida->id]);
    $web = Project::factory()->public()->create();

    foreach ([$ida, $lene] as $person) {
        ToggleFavorite::run(actor($person), ['kind' => 'view', 'id' => $view->id]);
    }
    ToggleFavorite::run(actor($lene), ['kind' => 'view', 'id' => $other->id]);
    ToggleFavorite::run(actor($lene), ['kind' => 'project', 'id' => $web->id]);

    DeleteView::run(actor($ida), $view);

    expect(View::query()->pluck('id')->all())->toBe([$other->id])
        ->and(Favorite::query()->where('favoritable_id', $view->id)->exists())->toBeFalse()
        ->and(Favorite::query()->orderBy('position')->pluck('favoritable_id')->all())->toBe([$other->id, $web->id]);

    $event = eventsOf(EventType::ViewDeleted)->sole();
    expect($event->actor_id)->toBe($ida->id)
        ->and($event->subject_id)->toBe($view->id)
        ->and($event->changes)->toBeNull()
        ->and($event->meta)->toMatchArray(['name' => 'Bugs in Produktion']);
});

it('lets org admins delete the view of somebody else', function () {
    $view = View::factory()->create();

    DeleteView::run(actor(User::factory()->admin()->create()), $view);

    expect(View::query()->count())->toBe(0);
});

it('refuses others with the reason', function () {
    $ida = User::factory()->create(['name' => 'Ida Brenner']);
    $view = View::factory()->create(['created_by' => $ida->id, 'name' => 'Bugs in Produktion']);

    $problem = problemOf(fn () => DeleteView::run(actor(User::factory()->create()), $view));

    expect($problem->status)->toBe(403)
        ->and($problem->detail)->toBe(__('problem.detail.view_creator_only', ['name' => 'Ida Brenner', 'view' => 'Bugs in Produktion']))
        ->and(View::query()->count())->toBe(1)
        ->and(eventsOf(EventType::ViewDeleted)->count())->toBe(0);
});

it('answers 404 for a view deleted meanwhile', function () {
    $ida = User::factory()->create();
    $view = View::factory()->create(['created_by' => $ida->id]);
    View::query()->whereKey($view->id)->delete();

    expect(problemOf(fn () => DeleteView::run(actor($ida), $view))->status)->toBe(404)
        ->and(eventsOf(EventType::ViewDeleted)->count())->toBe(0);
});
