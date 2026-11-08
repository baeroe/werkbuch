<?php

use App\Access\ProjectRole;
use App\Actions\Automations\ListAutomations;
use App\Actions\Automations\SaveAutomation;
use App\Domain\Automations\AutomationKey;
use App\Events\EventType;
use App\Models\Automation;
use App\Models\Project;
use App\Models\User;
use App\Models\Workflow;
use App\Support\ProjectAutomations;
use Illuminate\Support\Facades\DB;

// Switching the automations of a project (spec 4.13): five per project, the four old ones off and link_references on, changed only by its admins, one event
// per real change.

/** WEB (public, the default workflow) with Mara as its admin and Tom as a member. */
$world = function (): array {
    $mara = User::factory()->create(['name' => 'Mara']);
    $tom = User::factory()->create(['name' => 'Tom']);
    $web = Project::factory()->identifier('WEB')->public()->member($mara, ProjectRole::Admin)->member($tom, ProjectRole::Member)->create();

    return [$web, $mara, $tom];
};

/** The id of the state of that name in the workflow of the project. */
$state = fn (Project $project, string $name): string => (string) $project->workflow()->firstOrFail()->states()->where('name', $name)->value('id');

/** What an automation reads as: key, enabled and settings. */
$shape = fn (Automation $a): array => ['key' => $a->key->value, 'enabled' => $a->enabled, 'settings' => $a->settings, 'stored' => $a->exists];

it('lists five automations, link_references on without a row, for a new project', function () use ($world, $shape) {
    [$web, $mara] = $world();

    expect(array_map($shape, ListAutomations::run(actor($mara), $web)))->toBe([
        ['key' => 'auto_archive', 'enabled' => false, 'settings' => ['days' => 30], 'stored' => false],
        ['key' => 'auto_close', 'enabled' => false, 'settings' => ['days' => 90, 'state_id' => null], 'stored' => false],
        ['key' => 'close_parent', 'enabled' => false, 'settings' => [], 'stored' => false],
        ['key' => 'assign_on_start', 'enabled' => false, 'settings' => [], 'stored' => false],
        ['key' => 'link_references', 'enabled' => true, 'settings' => [], 'stored' => false],
    ])
        ->and(array_map(fn (Automation $a) => $a->project_id, ListAutomations::run(actor($mara), 'web')))->toBe(array_fill(0, 5, $web->id))
        ->and(Automation::query()->count())->toBe(0);
});

it('lists the stored ones with the missing ones in the order of the keys, in one query', function () use ($world, $shape) {
    [$web, $mara] = $world();
    Automation::factory()->for($web)->key(AutomationKey::AssignOnStart)->enabled()->create();
    Automation::factory()->for($web)->key(AutomationKey::AutoArchive)->enabled(['days' => 7])->create();
    Automation::factory()->for(Project::factory())->key(AutomationKey::CloseParent)->enabled()->create();

    DB::enableQueryLog();
    $all = ProjectAutomations::of($web->id);
    $queries = count(DB::getQueryLog());
    DB::disableQueryLog();

    expect($queries)->toBe(1)
        ->and(array_keys($all))->toBe(['auto_archive', 'auto_close', 'close_parent', 'assign_on_start', 'link_references'])
        ->and(array_map($shape, array_values($all)))->toBe([
            ['key' => 'auto_archive', 'enabled' => true, 'settings' => ['days' => 7], 'stored' => true],
            ['key' => 'auto_close', 'enabled' => false, 'settings' => ['days' => 90, 'state_id' => null], 'stored' => false],
            ['key' => 'close_parent', 'enabled' => false, 'settings' => [], 'stored' => false],
            ['key' => 'assign_on_start', 'enabled' => true, 'settings' => [], 'stored' => true],
            ['key' => 'link_references', 'enabled' => true, 'settings' => [], 'stored' => false],
        ])
        ->and(ProjectAutomations::enabled($web->id, AutomationKey::AutoArchive)?->settings)->toBe(['days' => 7])
        ->and(ProjectAutomations::enabled($web->id, AutomationKey::AutoClose))->toBeNull()
        ->and(ProjectAutomations::enabled($web->id, AutomationKey::CloseParent))->toBeNull();
});

it('reads link_references as enabled without a row and as off with a row that says so', function () use ($world) {
    [$web] = $world();

    $unstored = ProjectAutomations::enabled($web->id, AutomationKey::LinkReferences);
    expect($unstored?->enabled)->toBeTrue()
        ->and($unstored?->exists)->toBeFalse();

    Automation::factory()->for($web)->key(AutomationKey::LinkReferences)->create(['enabled' => false]);
    expect(ProjectAutomations::enabled($web->id, AutomationKey::LinkReferences))->toBeNull();

    Automation::query()->where('project_id', $web->id)->update(['enabled' => true]);
    expect(ProjectAutomations::enabled($web->id, AutomationKey::LinkReferences)?->exists)->toBeTrue();
});

it('hides the automations of a project the reader does not see', function () use ($world) {
    [, $mara] = $world();
    $ops = Project::factory()->identifier('OPS')->private()->create();
    $gone = Project::factory()->public()->create(['deleting_at' => now()]);

    expect(problemOf(fn () => ListAutomations::run(actor($mara), $ops))->status)->toBe(404)
        ->and(problemOf(fn () => ListAutomations::run(actor($mara), 'NOPE'))->status)->toBe(404)
        ->and(problemOf(fn () => ListAutomations::run(actor($mara), $gone))->status)->toBe(404)
        ->and(problemOf(fn () => SaveAutomation::run(actor($mara), $ops, 'auto_archive', ['enabled' => true]))->status)->toBe(404)
        ->and(problemOf(fn () => SaveAutomation::run(actor($mara), 'NOPE', 'auto_archive', ['enabled' => true]))->status)->toBe(404);
});

it('switches Auto-Archive on with 30 days and writes one event', function () use ($world, $shape) {
    [$web, $mara] = $world();

    $saved = SaveAutomation::run(actor($mara), 'WEB', 'auto_archive', ['enabled' => true, 'settings' => ['days' => 30]]);
    $event = eventsOf(EventType::AutomationUpdated)->sole();

    expect($shape($saved))->toBe(['key' => 'auto_archive', 'enabled' => true, 'settings' => ['days' => 30], 'stored' => true])
        ->and(Automation::query()->sole()->only(['id', 'project_id', 'enabled', 'settings']))->toBe(['id' => $saved->id, 'project_id' => $web->id, 'enabled' => true, 'settings' => ['days' => 30]])
        ->and($event->actor_id)->toBe($mara->id)
        ->and($event->subject_type)->toBe('automation')
        ->and($event->subject_id)->toBe($saved->id)
        ->and($event->project_id)->toBe($web->id)
        ->and($event->changes)->toBe(['enabled' => ['old' => false, 'new' => true]]);

    // the days of a stored one: one event with only the days, the switch untouched
    SaveAutomation::run(actor($mara), $web, 'auto_archive', ['enabled' => '1', 'settings' => ['days' => 7]]);

    expect(eventsOf(EventType::AutomationUpdated)->last()?->changes)->toBe(['days' => ['old' => 30, 'new' => 7]])
        ->and(Automation::query()->sole()->settings)->toBe(['days' => 7])
        ->and(Automation::query()->sole()->id)->toBe($saved->id);
});

it('keeps the settings it is not sent and takes only the settings of its key', function () use ($world, $state, $shape) {
    [$web, $mara] = $world();
    $cancelled = $state($web, 'Cancelled');

    SaveAutomation::run(actor($mara), $web, 'auto_close', ['enabled' => true, 'settings' => ['state_id' => strtoupper($cancelled), 'other' => 1]]);
    $kept = SaveAutomation::run(actor($mara), $web, 'auto_close', ['enabled' => false]);
    $parent = SaveAutomation::run(actor($mara), $web, 'close_parent', ['enabled' => true, 'settings' => ['days' => 5]]);

    expect($shape($kept))->toBe(['key' => 'auto_close', 'enabled' => false, 'settings' => ['days' => 90, 'state_id' => $cancelled], 'stored' => true])
        ->and(eventsOf(EventType::AutomationUpdated)->first()?->changes)->toBe(['enabled' => ['old' => false, 'new' => true], 'state_id' => ['old' => null, 'new' => $cancelled]])
        ->and($parent->settings)->toBe([])
        ->and(eventsOf(EventType::AutomationUpdated)->last()?->changes)->toBe(['enabled' => ['old' => false, 'new' => true]]);

    // a sent null takes the state away while the automation is off
    $cleared = SaveAutomation::run(actor($mara), $web, 'auto_close', ['enabled' => false, 'settings' => ['state_id' => null]]);

    expect($cleared->settings)->toBe(['days' => 90, 'state_id' => null])
        ->and(eventsOf(EventType::AutomationUpdated)->last()?->changes)->toBe(['state_id' => ['old' => $cancelled, 'new' => null]]);
});

it('refuses days below 1 and a state that is not canceled', function () use ($world, $state) {
    [$web, $mara] = $world();
    $other = Workflow::factory()->create();
    $save = fn (string $key, array $input) => invalidOf(fn () => SaveAutomation::run(actor($mara), $web, $key, $input));
    $days = __('field.settings.days', ['min' => 1, 'max' => 3650]);
    $canceled = __('field.settings.state_id');

    expect($save('auto_archive', ['enabled' => true, 'settings' => ['days' => 0]]))->toBe(['settings.days' => [$days]])
        ->and($save('auto_archive', ['enabled' => true, 'settings' => ['days' => 3651]]))->toBe(['settings.days' => [$days]])
        ->and($save('auto_archive', ['enabled' => true, 'settings' => ['days' => 1.5]]))->toBe(['settings.days' => [$days]])
        ->and($save('auto_archive', ['enabled' => true, 'settings' => ['days' => '30']]))->toBe(['settings.days' => [$days]])
        ->and($save('auto_archive', ['enabled' => true, 'settings' => ['days' => null]]))->toBe(['settings.days' => [$days]])
        ->and($save('auto_close', ['enabled' => true, 'settings' => ['days' => 0, 'state_id' => $state($web, 'Done')]]))->toBe(['settings.days' => [$days], 'settings.state_id' => [$canceled]])
        ->and($save('auto_close', ['enabled' => false, 'settings' => ['state_id' => $other->states()->value('id')]]))->toBe(['settings.state_id' => [$canceled]])
        ->and($save('auto_close', ['enabled' => false, 'settings' => ['state_id' => 'st_new']]))->toBe(['settings.state_id' => [$canceled]])
        ->and($save('auto_close', ['enabled' => false, 'settings' => ['state_id' => ['x']]]))->toBe(['settings.state_id' => [$canceled]])
        ->and($save('auto_archive', ['enabled' => 'yes']))->toBe(['enabled' => [__('field.boolean')]])
        ->and($save('auto_archive', []))->toBe(['enabled' => [__('field.required')]])
        ->and($save('auto_archive', ['enabled' => null]))->toBe(['enabled' => [__('field.required')]])
        ->and($save('auto_archive', ['enabled' => true, 'settings' => 'days']))->toBe(['settings' => [__('field.settings.object')]])
        ->and($save('auto_archive', ['enabled' => true, 'settings' => [30]]))->toBe(['settings' => [__('field.settings.object')]])
        ->and(Automation::query()->count())->toBe(0)
        ->and(eventsOf(EventType::AutomationUpdated))->toHaveCount(0);
});

it('refuses to switch Auto-Close on without a state', function () use ($world, $state) {
    [$web, $mara] = $world();
    $refused = ['settings.state_id' => [__('field.settings.state_id')]];

    expect(invalidOf(fn () => SaveAutomation::run(actor($mara), $web, 'auto_close', ['enabled' => true])))->toBe($refused)
        ->and(invalidOf(fn () => SaveAutomation::run(actor($mara), $web, 'auto_close', ['enabled' => true, 'settings' => ['state_id' => null]])))->toBe($refused)
        ->and(Automation::query()->count())->toBe(0);

    // a stored state that is no longer canceled (K11) keeps an automation that is off saveable, never one switched on
    Automation::factory()->for($web)->key(AutomationKey::AutoClose)->create(['settings' => ['days' => 90, 'state_id' => $state($web, 'Done')]]);

    expect(SaveAutomation::run(actor($mara), $web, 'auto_close', ['enabled' => false, 'settings' => ['days' => 60]])->settings)->toBe(['days' => 60, 'state_id' => $state($web, 'Done')])
        ->and(invalidOf(fn () => SaveAutomation::run(actor($mara), $web, 'auto_close', ['enabled' => true])))->toBe($refused);
});

it('lets a member read, not change (403 automations_admins_only)', function () use ($world) {
    [$web, , $tom] = $world();
    $viewer = memberOf($web, ProjectRole::Viewer);
    $outsider = User::factory()->create();

    $refusal = problemOf(fn () => SaveAutomation::run(actor($tom), $web, 'auto_archive', ['enabled' => true]));

    expect(ListAutomations::run(actor($tom), $web))->toHaveCount(5)
        ->and(ListAutomations::run(actor($outsider), $web))->toHaveCount(5)
        ->and($refusal->status)->toBe(403)
        ->and($refusal->detail)->toBe(__('problem.detail.automations_admins_only'))
        ->and(problemOf(fn () => SaveAutomation::run(actor($viewer), $web, 'auto_archive', ['enabled' => true]))->status)->toBe(403)
        ->and(SaveAutomation::run(actor(User::factory()->admin()->create()), $web, 'assign_on_start', ['enabled' => true])->enabled)->toBeTrue()
        ->and(SaveAutomation::run(actor(User::defaultBot()), $web, 'assign_on_start', ['enabled' => false])->enabled)->toBeFalse();
});

it('answers an unknown key with a 404 before anything else', function () use ($world) {
    [$web, $mara, $tom] = $world();

    expect(problemOf(fn () => SaveAutomation::run(actor($mara), $web, 'auto_nothing', ['enabled' => true]))->status)->toBe(404)
        ->and(problemOf(fn () => SaveAutomation::run(actor($tom), $web, 'AUTO_ARCHIVE', []))->status)->toBe(404);
});

it('stays changeable for the admins of an archived project', function () use ($world) {
    [$web, $mara] = $world();
    $web->update(['archived_at' => now()]);

    expect(SaveAutomation::run(actor($mara), $web, 'close_parent', ['enabled' => true])->enabled)->toBeTrue()
        ->and(eventsOf(EventType::AutomationUpdated))->toHaveCount(1);
});

it('writes no event when nothing changes', function () use ($world, $shape) {
    [$web, $mara] = $world();

    // the defaults of a key without a row: nothing to store
    $unstored = SaveAutomation::run(actor($mara), $web, 'auto_archive', ['enabled' => false, 'settings' => ['days' => 30]]);

    expect($shape($unstored))->toBe(['key' => 'auto_archive', 'enabled' => false, 'settings' => ['days' => 30], 'stored' => false])
        ->and(Automation::query()->count())->toBe(0);

    $saved = SaveAutomation::run(actor($mara), $web, 'auto_archive', ['enabled' => true, 'settings' => ['days' => 30]]);
    $this->travel(5)->minutes();
    $again = SaveAutomation::run(actor($mara), $web, 'auto_archive', ['enabled' => true, 'settings' => ['days' => 30]]);

    expect(eventsOf(EventType::AutomationUpdated))->toHaveCount(1)
        ->and($again->id)->toBe($saved->id)
        ->and($again->updated_at?->toJSON())->toBe($saved->updated_at?->toJSON());
});

it('writes nothing when link_references is switched on without a row', function () use ($world) {
    [$web, $mara] = $world();

    $saved = SaveAutomation::run(actor($mara), $web, 'link_references', ['enabled' => true]);

    expect($saved->enabled)->toBeTrue()
        ->and($saved->exists)->toBeFalse()
        ->and(Automation::query()->count())->toBe(0)
        ->and(eventsOf(EventType::AutomationUpdated))->toHaveCount(0);
});

it('stores a row and an event when link_references is switched off', function () use ($world) {
    [$web, $mara] = $world();

    $saved = SaveAutomation::run(actor($mara), $web, 'link_references', ['enabled' => false]);
    $event = eventsOf(EventType::AutomationUpdated)->sole();

    expect($saved->enabled)->toBeFalse()
        ->and($saved->exists)->toBeTrue()
        ->and(Automation::query()->sole()->enabled)->toBeFalse()
        ->and($event->changes)->toBe(['enabled' => ['old' => true, 'new' => false]])
        ->and($event->project_id)->toBe($web->id);
});
