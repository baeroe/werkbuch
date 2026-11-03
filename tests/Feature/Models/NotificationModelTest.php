<?php

use App\Access\OrgRole;
use App\Access\ProjectRole;
use App\Access\RoleAssignments;
use App\Access\Visibility;
use App\Domain\Notifications\Channel;
use App\Domain\Notifications\NotificationKind;
use App\Models\Event;
use App\Models\Notification;
use App\Models\NotificationMail;
use App\Models\Project;
use App\Models\User;
use App\Models\WorkItem;
use Illuminate\Database\UniqueConstraintViolationException;
use Illuminate\Support\Carbon;

it('knows its person, project, item, actor, collection and event', function () {
    $item = WorkItem::factory()->create();
    $actor = User::factory()->create();
    $event = Event::query()->firstOrFail();
    $mail = NotificationMail::factory()->create();
    $notification = Notification::factory()->forItem($item)->create([
        'actor_id' => $actor->id, 'event_id' => $event->id, 'mail_id' => $mail->id, 'user_id' => $mail->user_id,
    ]);

    expect($notification->user->is($mail->user))->toBeTrue()
        ->and($notification->project?->is($item->project))->toBeTrue()
        ->and($notification->workItem?->is($item))->toBeTrue()
        ->and($notification->actor?->is($actor))->toBeTrue()
        ->and($notification->mail?->is($mail))->toBeTrue()
        ->and($notification->event?->is($event))->toBeTrue()
        ->and($mail->notifications->modelKeys())->toBe([$notification->id])
        ->and($mail->user->is($notification->user))->toBeTrue();
});

it('casts its kind, data, inbox flag and read moment with microseconds', function () {
    $notification = Notification::factory()->kind(NotificationKind::StateChanged, ['from' => ['id' => 'a'], 'to' => ['id' => 'b']])->read()->create();
    Carbon::setTestNow('2026-11-03 10:15:00.123456');
    $later = Notification::factory()->mailOnly()->create(['read_at' => now()]);
    Carbon::setTestNow();

    $fresh = $notification->fresh();
    expect($fresh?->kind)->toBe(NotificationKind::StateChanged)
        ->and($fresh?->data)->toBe(['from' => ['id' => 'a'], 'to' => ['id' => 'b']])
        ->and($fresh?->inbox)->toBeTrue()
        ->and($fresh?->read_at)->toBeInstanceOf(Carbon::class)
        ->and($later->fresh()?->inbox)->toBeFalse()
        ->and($later->fresh()?->read_at?->format('u'))->toBe('123456')
        ->and(Notification::factory()->create()->fresh()?->read_at)->toBeNull();
});

it('keeps one notification per person and dedupe key', function () {
    $first = Notification::factory()->create(['dedupe_key' => 'event:one']);
    Notification::factory()->create(['dedupe_key' => 'event:one']);

    Notification::factory()->create(['user_id' => $first->user_id, 'dedupe_key' => 'event:one']);
})->throws(UniqueConstraintViolationException::class);

it('keeps one open collection per person and scope', function () {
    $mail = NotificationMail::factory()->create();

    NotificationMail::factory()->create(['user_id' => $mail->user_id, 'scope' => $mail->scope]);
})->throws(UniqueConstraintViolationException::class);

it('goes with its item and its project', function () {
    $item = WorkItem::factory()->create();
    $onItem = Notification::factory()->forItem($item)->create();
    $other = Notification::factory()->forItem(WorkItem::factory()->create())->create();

    $item->delete();
    expect($onItem->fresh())->toBeNull()->and($other->fresh())->not->toBeNull();

    $other->project?->delete();
    expect($other->fresh())->toBeNull();
});

it('lets the person see notifications of the projects they see, and the organization ones only as org admin (K5)', function () {
    $ida = User::factory()->create();
    $public = Project::factory()->public()->create();
    $private = Project::factory()->private()->create();
    $own = Project::factory()->private()->member($ida, ProjectRole::Member)->create();
    $seen = [
        Notification::factory()->forItem(WorkItem::factory()->for($public)->create())->create(['user_id' => $ida->id]),
        Notification::factory()->forItem(WorkItem::factory()->for($own)->create())->create(['user_id' => $ida->id]),
    ];
    $hidden = Notification::factory()->forItem(WorkItem::factory()->for($private)->create())->create(['user_id' => $ida->id]);
    $webhook = Notification::factory()->kind(NotificationKind::WebhookDisabled, ['webhook_id' => 'w1'])->create(['user_id' => $ida->id, 'project_id' => null, 'work_item_id' => null]);
    // a notification without a project that is no organization notification is nobody's
    Notification::factory()->create(['user_id' => $ida->id, 'project_id' => null, 'work_item_id' => null]);

    $visible = fn () => Notification::query()->visibleTo($ida)->orderBy('id')->pluck('id')->all();
    expect($visible())->toBe(collect($seen)->pluck('id')->sort()->values()->all());

    app(RoleAssignments::class)->setOrgRole($ida, OrgRole::Admin);
    Visibility::forget();
    expect($visible())->toBe(collect([...$seen, $hidden, $webhook])->pluck('id')->sort()->values()->all());

    // a project being deleted and a deactivated account see nothing
    $public->update(['deleting_at' => now()]);
    Visibility::forget();
    expect($visible())->not->toContain($seen[0]->id);

    $ida->update(['disabled_at' => now()]);
    Visibility::forget();
    expect($visible())->toBe([]);
});

it('knows the notification preferences of an account', function () {
    $mara = User::factory()->create();
    $mara->notificationPreferences()->create(['kind' => 'comment', 'channel' => 'mail', 'enabled' => false]);

    expect($mara->notificationPreferences()->sole()->only(['kind', 'channel', 'enabled']))->toBe(['kind' => NotificationKind::Comment, 'channel' => Channel::Mail, 'enabled' => false]);
});
