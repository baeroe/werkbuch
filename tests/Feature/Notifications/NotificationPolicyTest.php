<?php

use App\Access\Authorize;
use App\Access\ProjectRole;
use App\Access\RoleAssignments;
use App\Access\Visibility;
use App\Models\Notification;
use App\Models\Project;
use App\Models\User;
use App\Models\WorkItem;

it('lets a person read, mark and delete only their own visible notifications, else 404 (K19)', function (string $ability) {
    $ida = User::factory()->create();
    $ops = Project::factory()->private()->member($ida, ProjectRole::Member)->create();
    $own = Notification::factory()->forItem(WorkItem::factory()->for($ops)->create())->create(['user_id' => $ida->id]);
    $other = Notification::factory()->forItem(WorkItem::factory()->for($ops)->create())->create();

    expect(Authorize::allows(actor($ida), $ability, $own))->toBeTrue()
        ->and(refusal($ida, $ability, $other)->status)->toBe(404)
        // an org admin sees the project, but the notification stays the other person's
        ->and(refusal(User::factory()->admin()->create(), $ability, $other)->status)->toBe(404);

    // once the person no longer sees the project, the own notification is gone as well
    app(RoleAssignments::class)->removeFromProject($ida, $ops);
    Visibility::forget();

    expect(refusal($ida, $ability, $own->fresh())->status)->toBe(404)
        ->and(refusal($ida, $ability, $own)->detail)->toBeNull();
})->with(['view', 'update', 'delete']);

it('lets only people manage notification preferences', function () {
    expect(Authorize::allows(actor(User::factory()->create()), 'managePreferences', Notification::class))->toBeTrue()
        ->and(refusal(User::defaultBot(), 'managePreferences', Notification::class)->status)->toBe(403)
        ->and(refusal(User::defaultBot(), 'managePreferences', Notification::class)->detail)->toBe(__('problem.detail.persons_only_notifications'));
});
