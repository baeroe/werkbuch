<?php

use App\Access\ProjectRole;
use App\Access\RoleAssignments;
use App\Actions\Projects\ArchiveProject;
use App\Actions\WorkItems\CreateWorkItem;
use App\Actions\WorkItems\ListSubscribers;
use App\Actions\WorkItems\SetSubscription;
use App\Actions\WorkItems\UpdateWorkItem;
use App\Events\EventType;
use App\Models\Project;
use App\Models\User;
use App\Models\WorkItem;
use App\Models\WorkItemSubscriber;
use Illuminate\Database\Events\QueryExecuted;
use Illuminate\Support\Facades\DB;

/** WEB (public) with Mara as its admin and lead. */
$web = function (): array {
    $mara = User::factory()->create(['name' => 'Mara']);
    $web = Project::factory()->identifier('WEB')->public()->member($mara, ProjectRole::Admin)->create(['lead_id' => $mara->id]);

    return [$web, $mara];
};

$row = fn (WorkItem $item, User $user): ?WorkItemSubscriber => WorkItemSubscriber::query()->where('work_item_id', $item->id)->where('user_id', $user->id)->first();

it('lets a viewer watch an item', function () use ($web, $row) {
    [$project] = $web();
    $viewer = memberOf($project, ProjectRole::Viewer);
    $item = WorkItem::factory()->for($project)->create();

    $watching = SetSubscription::run(actor($viewer), $item, true);
    $subscribed = [$row($item, $viewer)?->reason, $row($item, $viewer)?->unsubscribed_at];
    $stopped = SetSubscription::run(actor($viewer), $item, false);

    expect($watching->subscribed)->toBeTrue()
        ->and($watching->relationLoaded('labels'))->toBeTrue()
        ->and($subscribed)->toBe(['manual', null])
        ->and($stopped->subscribed)->toBeFalse()
        ->and($row($item, $viewer)?->unsubscribed_at)->not->toBeNull()
        ->and(eventsOf(EventType::WorkItemSubscribed, $item)->sole()->actor_id)->toBe($viewer->id)
        ->and(eventsOf(EventType::WorkItemUnsubscribed, $item)->sole()->project_id)->toBe($project->id);
});

it('lets an outsider of a public project watch, and hides a private one', function () use ($web) {
    [$project] = $web();
    $outsider = User::factory()->create();
    $ops = Project::factory()->private()->create();

    $refused = problemOf(fn () => SetSubscription::run(actor($outsider), WorkItem::factory()->for($ops)->create(), true));

    expect(SetSubscription::run(actor($outsider), WorkItem::factory()->for($project)->create(), true)->subscribed)->toBeTrue()
        ->and($refused->status)->toBe(404);
});

it('refuses bots', function () use ($web) {
    [$project, $mara] = $web();
    $bot = User::factory()->bot($mara)->create();
    app(RoleAssignments::class)->setProjectRole($bot, $project, ProjectRole::Member);
    $item = WorkItem::factory()->for($project)->create();

    foreach ([$bot, User::defaultBot()] as $account) {
        $refused = problemOf(fn () => SetSubscription::run(actor($account), $item, true));
        expect([$refused->status, $refused->detail])->toBe([403, __('problem.detail.bots_dont_watch')]);
    }
    expect(WorkItemSubscriber::query()->count())->toBe(0);
});

it('keeps somebody who stopped watching out until a new assignment', function () use ($web, $row) {
    [$project, $mara] = $web();
    $lene = memberOf($project, ProjectRole::Member, ['name' => 'Lene']);
    $item = CreateWorkItem::run(actor($mara), ['project_id' => $project->id, 'title' => 'Formular prüfen', 'assignee_id' => $lene->id]);

    SetSubscription::run(actor($lene), $item, false);
    UpdateWorkItem::run(actor($mara), $item, ['title' => 'Formular gründlich prüfen']);
    $afterTitle = $row($item, $lene)?->unsubscribed_at;
    UpdateWorkItem::run(actor($mara), $item, ['assignee_id' => null]);
    UpdateWorkItem::run(actor($mara), $item, ['assignee_id' => $lene->id]);

    expect($afterTitle)->not->toBeNull()
        ->and($row($item, $lene)?->unsubscribed_at)->toBeNull()
        ->and($row($item, $lene)?->reason)->toBe('assigned')
        ->and(ListSubscribers::run(actor($lene), $item)->pluck('name')->all())->toBe(['Lene', 'Mara']);
});

it('records only real changes', function () use ($web, $row) {
    [$project, $mara] = $web();
    $lene = memberOf($project, ProjectRole::Member);
    $item = CreateWorkItem::run(actor($mara), ['project_id' => $project->id, 'title' => 'Formular prüfen']);

    // Mara watches as the creator already: no change
    SetSubscription::run(actor($mara), $item, true);
    SetSubscription::run(actor($lene), $item, true);
    SetSubscription::run(actor($lene), $item, true);
    SetSubscription::run(actor($lene), $item, false);
    $stamp = $row($item, $lene)?->unsubscribed_at?->toJSON();
    $this->travel(5)->minutes();
    SetSubscription::run(actor($lene), $item, false);

    expect($row($item, $mara)?->reason)->toBe('created')
        ->and(eventsOf(EventType::WorkItemSubscribed))->toHaveCount(1)
        ->and(eventsOf(EventType::WorkItemUnsubscribed))->toHaveCount(1)
        ->and($row($item, $lene)?->unsubscribed_at?->toJSON())->toBe($stamp);
});

it('stores an opt-out for a person who never watched', function () use ($web, $row) {
    [$project] = $web();
    $viewer = memberOf($project, ProjectRole::Viewer);
    $item = WorkItem::factory()->for($project)->create();

    SetSubscription::run(actor($viewer), $item, false);
    $stamp = $row($item, $viewer)?->unsubscribed_at?->toJSON();
    $this->travel(5)->minutes();
    SetSubscription::run(actor($viewer), $item, false);

    expect($row($item, $viewer)?->reason)->toBe('manual')
        ->and($stamp)->not->toBeNull()
        ->and($row($item, $viewer)?->unsubscribed_at?->toJSON())->toBe($stamp)
        ->and(eventsOf(EventType::WorkItemUnsubscribed, $item))->toHaveCount(1);
});

it('watches again after stopping, with reason manual', function () use ($web, $row) {
    [$project, $mara] = $web();
    $item = CreateWorkItem::run(actor($mara), ['project_id' => $project->id, 'title' => 'Formular prüfen']);

    SetSubscription::run(actor($mara), $item, false);
    SetSubscription::run(actor($mara), $item, true);

    expect([$row($item, $mara)?->reason, $row($item, $mara)?->unsubscribed_at])->toBe(['manual', null])
        ->and(WorkItemSubscriber::query()->count())->toBe(1)
        ->and(eventsOf(EventType::WorkItemSubscribed))->toHaveCount(1);
});

it('lists the active watchers only', function () use ($web) {
    [$project, $mara] = $web();
    $item = WorkItem::factory()->for($project)->create();
    $other = WorkItem::factory()->for($project)->create();
    [$zoe, $anna, $ben] = collect(['Zoe', 'Anna', 'Ben'])->map(fn (string $name) => memberOf($project, ProjectRole::Member, ['name' => $name]))->all();
    foreach ([$zoe, $anna, $ben] as $person) {
        SetSubscription::run(actor($person), $item, true);
    }
    SetSubscription::run(actor($ben), $item, false);
    SetSubscription::run(actor($mara), $other, true);
    $outsider = User::factory()->create();
    // a deactivated watcher keeps the row, but watches nothing meanwhile
    $ida = memberOf($project, ProjectRole::Member, ['name' => 'Ida']);
    SetSubscription::run(actor($ida), $item, true);
    $ida->forceFill(['disabled_at' => now()])->save();

    expect(ListSubscribers::run(actor($outsider), $item)->pluck('name')->all())->toBe(['Anna', 'Zoe'])
        ->and(ListSubscribers::run(actor($mara), $other)->sole()->relationLoaded('media'))->toBeTrue()
        ->and(problemOf(fn () => ListSubscribers::run(actor($outsider), WorkItem::factory()->for(Project::factory()->private()->create())->create()))->status)->toBe(404);
});

it('lets people watch in an archived project and an archived item', function () use ($web) {
    [$project, $mara] = $web();
    $archived = WorkItem::factory()->for($project)->archived()->create();
    $item = WorkItem::factory()->for($project)->create();
    ArchiveProject::run(actor($mara), $project, true);

    expect(SetSubscription::run(actor($mara), $archived, true)->subscribed)->toBeTrue()
        ->and(SetSubscription::run(actor($mara), $item, true)->subscribed)->toBeTrue();
});

it('locks the item without the organization', function () use ($web) {
    [$project, $mara] = $web();
    $item = WorkItem::factory()->for($project)->create();
    $queries = [];
    DB::listen(function (QueryExecuted $query) use (&$queries) {
        $queries[] = $query->sql;
    });

    SetSubscription::run(actor($mara), $item, true);

    expect(collect($queries)->filter(fn (string $sql) => str_contains($sql, '`organization`') && str_contains($sql, 'lock'))->all())->toBe([])
        ->and(collect($queries)->contains(fn (string $sql) => str_starts_with($sql, 'select * from `work_items`') && str_ends_with($sql, 'for update')))->toBeTrue();
});
