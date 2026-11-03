<?php

use App\Access\ProjectRole;
use App\Actions\Notifications\DeleteNotification;
use App\Exceptions\Problem;
use App\Models\Event;
use App\Models\Notification;
use App\Models\Project;
use App\Models\User;
use App\Models\WorkItem;

/*
 * Deleting from the inbox (Task 6): the own inbox notification the person still sees goes, without an event (A277);
 * anything else is a 404, never a 403 (K19, A273).
 */

$world = function (): array {
    $tom = User::factory()->create();
    $web = Project::factory()->public()->member($tom, ProjectRole::Admin)->create();
    $ops = Project::factory()->private()->member($tom, ProjectRole::Admin)->create();

    return ['mara' => memberOf($web, ProjectRole::Member), 'item' => WorkItem::factory()->for($web)->create(), 'secret' => WorkItem::factory()->for($ops)->create()];
};

it('deletes my own', function () use ($world) {
    $w = $world();
    $mine = Notification::factory()->forItem($w['item'])->create(['user_id' => $w['mara']->id]);
    $other = Notification::factory()->forItem($w['item'])->create(['user_id' => $w['mara']->id]);
    $before = Event::query()->count();

    DeleteNotification::run(actor($w['mara']), $mine);

    expect(Notification::query()->find($mine->id))->toBeNull()
        ->and($other->fresh())->not->toBeNull()
        ->and(Event::query()->count())->toBe($before);
});

it('answers 404 for a foreign one', function () use ($world) {
    $w = $world();
    $foreign = Notification::factory()->forItem($w['item'])->create();
    // the own row of a project Mara does not see, and the own row only for mail (A273)
    $hidden = Notification::factory()->forItem($w['secret'])->create(['user_id' => $w['mara']->id]);
    $mailOnly = Notification::factory()->forItem($w['item'])->mailOnly()->create(['user_id' => $w['mara']->id]);

    foreach ([$foreign, $hidden, $mailOnly] as $notification) {
        expect(fn () => DeleteNotification::run(actor($w['mara']), $notification))
            ->toThrow(fn (Problem $problem) => expect($problem->status)->toBe(404)->and($problem->detail)->toBeNull())
            ->and($notification->fresh())->not->toBeNull();
    }
});
