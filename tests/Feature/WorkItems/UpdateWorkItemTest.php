<?php

use App\Access\ProjectRole;
use App\Access\RoleAssignments;
use App\Actions\WorkItems\UpdateWorkItem;
use App\Domain\Properties\FieldType;
use App\Domain\WorkItems\Priority;
use App\Events\EventType;
use App\Exceptions\Problem;
use App\Models\Event;
use App\Models\Label;
use App\Models\Project;
use App\Models\Property;
use App\Models\Resolution;
use App\Models\User;
use App\Models\Workflow;
use App\Models\WorkItem;
use App\Models\WorkItemSubscriber;
use App\Models\WorkItemType;
use App\Models\WorkItemValue;
use App\Support\Actor;
use App\Support\ItemLock;
use Database\Seeders\Demo\CatalogSeeder;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use Tests\Support\RichTextFixtures as F;

/** WEB with Mara as its admin and lead, Ida as a member, and an item of Mara's. */
$web = function (): array {
    $mara = User::factory()->create(['name' => 'Mara']);
    $web = Project::factory()->identifier('WEB')->member($mara, ProjectRole::Admin)->create(['lead_id' => $mara->id]);
    $ida = memberOf($web, ProjectRole::Member, ['name' => 'Ida']);
    $item = WorkItem::factory()->for($web)->create(['title' => 'Formular prüfen', 'created_by' => $mara->id]);

    return [$web, $mara, $ida, $item];
};

/** A property the Task type asks for, at the end of its list. */
$askFor = function (Property $property, bool $required = false): Property {
    $task = WorkItemType::query()->where('name', 'Task')->firstOrFail();
    $task->typeProperties()->create(['property_id' => $property->id, 'required' => $required, 'position' => $task->typeProperties()->count()]);

    return $property;
};

$update = fn (User $user, WorkItem $item, array $input): WorkItem => UpdateWorkItem::run(actor($user), $item, $input);

it('changes only what is sent and records old and new', function () use ($web, $update) {
    [, $mara, , $item] = $web();
    $item->forceFill(['updated_at' => now()->subDay(), 'due_date' => '2026-11-30'])->save();

    $changed = $update($mara, $item, ['title' => '  Formular freigeben ', 'priority' => 'high']);
    $event = eventsOf(EventType::WorkItemUpdated, $item)->sole();

    expect($changed->title)->toBe('Formular freigeben')
        ->and($changed->priority)->toBe(Priority::High)
        ->and($changed->due_date?->format('Y-m-d'))->toBe('2026-11-30')
        ->and($changed->updated_at?->isToday())->toBeTrue()
        ->and($event->changes)->toBe([
            'title' => ['old' => 'Formular prüfen', 'new' => 'Formular freigeben'],
            'priority' => ['old' => 'none', 'new' => 'high'],
        ])
        ->and($event->actor_id)->toBe($mara->id)
        ->and($event->project_id)->toBe($item->project_id)
        // loaded for the resource, with the actor as reader
        ->and($changed->relationLoaded('labels'))->toBeTrue()
        ->and($changed->getAttribute('children_total'))->toBe(0)
        ->and(eventsOf(EventType::WorkItemAssigned))->toHaveCount(0);
});

it('records nothing when nothing changes', function () use ($web, $update) {
    [, $mara, , $item] = $web();
    [$a, $b] = Label::factory()->count(2)->create();
    $item->labels()->sync([$a->id, $b->id]);
    $item->forceFill(['updated_at' => now()->subDay(), 'priority' => Priority::Low, 'start_date' => '2026-11-01'])->save();
    $before = $item->fresh()?->updated_at?->toJSON();

    $same = $update($mara, $item, [
        'title' => 'Formular prüfen',
        'label_ids' => [strtoupper($b->id), $a->id, $b->id],
        'priority' => 'low',
        'start_date' => '2026-11-01',
        'due_date' => null,
        'parent_id' => null,
        'assignee_id' => null,
        'rank' => $item->rank,
        'description' => '',
        'values' => [],
    ]);

    expect(eventsOf(EventType::WorkItemUpdated))->toHaveCount(0)
        ->and(eventsOf(EventType::WorkItemAssigned))->toHaveCount(0)
        ->and($same->updated_at?->toJSON())->toBe($before)
        ->and($same->description_version)->toBe(1)
        // the apply of a bulk edit says so
        ->and(UpdateWorkItem::apply(actor($mara), ItemLock::take($item), ['title' => 'Formular prüfen']))->toBeFalse();
});

it('records the labels as lists in catalog order', function () use ($web, $update) {
    [, $mara, , $item] = $web();
    [$a, $b, $c] = Label::factory()->count(3)->create();
    $item->labels()->sync([$a->id]);

    $changed = $update($mara, $item, ['label_ids' => [$c->id, strtoupper($b->id)]]);

    expect($changed->labels->modelKeys())->toBe([$b->id, $c->id])
        ->and(eventsOf(EventType::WorkItemUpdated, $item)->sole()->changes)->toBe(['label_ids' => ['old' => [$a->id], 'new' => [$b->id, $c->id]]])
        ->and(invalidOf(fn () => $update($mara, $item, ['label_ids' => [$a->id, (string) Str::ulid()]])))->toBe(['label_ids' => [__('field.label_ids.unknown')]])
        ->and($update($mara, $item, ['label_ids' => null])->labels)->toHaveCount(0);
});

it('counts the version of the description up and keeps its text for search', function () use ($web, $update) {
    [, $mara, , $item] = $web();

    $first = $update($mara, $item, ['description' => 'Erst **lesen**.']);
    $json = $first->description;
    $again = $update($mara, $item, ['description_json' => $json, 'base_description_version' => 2]);
    $cleared = $update($mara, $item, ['description' => null, 'base_description_version' => 2]);
    $events = eventsOf(EventType::WorkItemUpdated, $item);

    expect($json)->toBe(F::doc(F::p('Erst ', F::text('lesen', 'bold'), '.')))
        ->and($first->description_version)->toBe(2)
        ->and($first->description_text)->toBe('Erst lesen.')
        // the same document again changes nothing
        ->and($again->description_version)->toBe(2)
        ->and($cleared->description_version)->toBe(3)
        ->and($cleared->description)->toBeNull()
        ->and($cleared->description_text)->toBeNull()
        ->and($events->map(fn ($event) => $event->changes)->all())->toBe([
            ['description' => ['old' => null, 'new' => $json]],
            ['description' => ['old' => $json, 'new' => null]],
        ]);
});

it('refuses a description edited on an old version with the current item and the name of the editor', function () use ($web, $update) {
    [$project, $mara, $ida, $item] = $web();
    $lene = memberOf($project, ProjectRole::Member, ['name' => 'Lene']);
    // Mara saves first, then Ida on Mara's version, then Mara changes another field while still editing her old
    // version: the one who changed the description last is named, not the last one who changed anything
    $update($mara, $item, ['description' => 'Erste Fassung', 'base_description_version' => 1]);
    $update($ida, $item, ['description' => 'Fassung von Ida', 'base_description_version' => 2]);
    $update($mara, $item, ['priority' => 'low']);
    // the description of another item does not count
    $update($lene, WorkItem::factory()->for($project)->create(), ['description' => 'Woanders']);

    $problem = problemOf(fn () => $update($mara, $item, ['title' => 'Neu', 'description' => 'Fassung von Mara', 'base_description_version' => 2]));
    $stored = $item->fresh();

    expect([$problem->status, $problem->reason, $problem->detail])->toBe([409, 'description_conflict', __('problem.detail.description_conflict', ['name' => 'Ida'])])
        ->and(__('problem.detail.description_conflict', ['name' => 'Ida'], 'de'))->toBe('Ida hat die Beschreibung inzwischen geändert.')
        ->and($problem->extensions['current']['description_version'])->toBe(3)
        ->and($problem->extensions['current']['description'])->toBe('Fassung von Ida')
        ->and($problem->extensions['current']['subscribed'])->toBeFalse()
        // nothing of the refused change was written
        ->and($stored?->title)->toBe('Formular prüfen')
        ->and($stored?->description_version)->toBe(3)
        // on the current version it goes through; a version without a change of the description does not matter
        ->and($update($mara, $item, ['description' => 'Fassung von Mara', 'base_description_version' => 3])->description_version)->toBe(4)
        ->and($update($mara, $item, ['title' => 'Neu', 'description' => 'Fassung von Mara', 'base_description_version' => 1])->title)->toBe('Neu');
});

it('names someone when no event says who changed the description', function () use ($web, $update) {
    [, $mara, , $item] = $web();
    $item->forceFill(['description_version' => 4])->save();

    $problem = problemOf(fn () => $update($mara, $item, ['description' => 'Neu', 'base_description_version' => 3]));

    expect($problem->detail)->toBe(__('problem.detail.description_conflict', ['name' => __('items.someone')]))
        ->and(__('items.someone', [], 'de'))->toBe('Jemand')
        ->and(__('items.someone', [], 'en'))->toBe('Someone');
});

it('lets the last write win without a version', function () use ($web, $update) {
    [, $mara, $ida, $item] = $web();
    $update($ida, $item, ['description' => 'Fassung von Ida']);

    $last = $update($mara, $item, ['description' => 'Fassung von Mara']);

    expect($last->description_version)->toBe(3)
        ->and($last->description_text)->toBe('Fassung von Mara');
});

it('keeps an item valid that lacks a value which became required later', function () use ($web, $update, $askFor) {
    [, $mara, , $item] = $web();
    $customer = $askFor(Property::factory()->create(['key' => 'customer', 'label' => 'Kunde']));
    WorkItemType::query()->where('name', 'Task')->firstOrFail()->typeProperties()->where('property_id', $customer->id)->update(['required' => true]);

    $renamed = $update($mara, $item, ['title' => 'Umbenannt', 'values' => ['customer' => null]]);
    $filled = $update($mara, $item, ['values' => ['customer' => 'Feldwerk']]);

    expect($renamed->title)->toBe('Umbenannt')
        ->and($filled->values->pluck('value_string')->all())->toBe(['Feldwerk'])
        ->and(invalidOf(fn () => $update($mara, $item, ['values' => ['customer' => '']])))->toBe(['values.customer' => [__('field.values.required', ['label' => 'Kunde'])]])
        ->and(invalidOf(fn () => $update($mara, $item, ['values' => ['unknown' => 'x']])))->toBe(['values.unknown' => [__('field.values.unknown', ['key' => 'unknown', 'type' => 'Task'])]])
        ->and(invalidOf(fn () => $update($mara, $item, ['values' => ['Feldwerk']])))->toBe(['values' => [__('field.values.invalid')]]);
});

it('changes only the values it is sent', function () use ($web, $update, $askFor) {
    [, $mara, , $item] = $web();
    $askFor(Property::factory()->create(['key' => 'customer', 'label' => 'Kunde']));
    $askFor(Property::factory()->create(['key' => 'budget', 'label' => 'Budget', 'field_type' => FieldType::Number]));
    $notes = $askFor(Property::factory()->create(['key' => 'notes', 'label' => 'Notizen', 'field_type' => FieldType::RichText]));
    $update($mara, $item, ['values' => ['customer' => 'Feldwerk', 'budget' => 12]]);
    $kept = WorkItemValue::query()->where('value_string', 'Feldwerk')->sole()->id;

    $changed = $update($mara, $item, ['values' => ['budget' => 20, 'notes' => '_Wichtig_']]);
    $events = eventsOf(EventType::WorkItemUpdated, $item);

    expect($events->last()?->changes)->toBe([
        'values.budget' => ['old' => 12, 'new' => 20],
        'values.notes' => ['old' => null, 'new' => F::doc(F::p(F::text('Wichtig', 'italic')))],
    ])
        ->and(WorkItemValue::query()->where('value_string', 'Feldwerk')->sole()->id)->toBe($kept)
        ->and($changed->values->where('property_id', $notes->id))->toHaveCount(1)
        ->and($events->first()?->changes)->toBe([
            'values.budget' => ['old' => null, 'new' => 12],
            'values.customer' => ['old' => null, 'new' => 'Feldwerk'],
        ])
        // a value removed is a change to null
        ->and($update($mara, $item, ['values' => ['customer' => null]])->values->where('value_string', 'Feldwerk'))->toHaveCount(0)
        ->and(eventsOf(EventType::WorkItemUpdated, $item)->last()?->changes)->toBe(['values.customer' => ['old' => 'Feldwerk', 'new' => null]]);
});

it('stores a number as large as the column holds and refuses a larger one at the field', function () use ($web, $update, $askFor) {
    [, $mara, , $item] = $web();
    $askFor(Property::factory()->create(['key' => 'budget', 'label' => 'Budget', 'field_type' => FieldType::Number, 'settings' => ['decimals' => 2]]));

    $stored = $update($mara, $item, ['values' => ['budget' => -99999999999999983616.0]]);

    // decimal(24,4) holds 20 digits before the point: a larger number was an error of the database (a 500)
    expect((float) WorkItemValue::query()->where('work_item_id', $item->id)->sole()->value_number)->toBe(-99999999999999983616.0)
        ->and($stored->values)->toHaveCount(1)
        ->and(invalidOf(fn () => $update($mara, $item, ['values' => ['budget' => 1e21]])))->toBe(['values.budget' => [__('field.values.number_range', ['label' => 'Budget'])]])
        ->and(invalidOf(fn () => $update($mara, $item, ['values' => ['budget' => '100000000000000000000']])))->toBe(['values.budget' => [__('field.values.number_range', ['label' => 'Budget'])]]);
});

it('checks a new start date against the stored due date', function () use ($web, $update) {
    [, $mara, , $item] = $web();
    $item->forceFill(['start_date' => '2026-11-01', 'due_date' => '2026-11-10'])->save();

    expect(invalidOf(fn () => $update($mara, $item, ['start_date' => '2026-11-20'])))->toBe(['due_date' => [__('field.due_date.before_start')]])
        ->and(invalidOf(fn () => $update($mara, $item, ['due_date' => '2026-10-31'])))->toBe(['due_date' => [__('field.due_date.before_start')]])
        ->and(invalidOf(fn () => $update($mara, $item, ['start_date' => "2026-11-02\n"])))->toBe(['start_date' => [__('field.date.invalid')]]);

    $moved = $update($mara, $item, ['start_date' => '2026-11-20', 'due_date' => null]);

    expect([$moved->start_date?->format('Y-m-d'), $moved->due_date])->toBe(['2026-11-20', null])
        ->and(eventsOf(EventType::WorkItemUpdated, $item)->sole()->changes)->toBe([
            'start_date' => ['old' => '2026-11-01', 'new' => '2026-11-20'],
            'due_date' => ['old' => '2026-11-10', 'new' => null],
        ]);
});

it('records a change of the assignee as its own event and makes them watch', function () use ($web, $update) {
    [$project, $mara, $ida, $item] = $web();
    WorkItemSubscriber::query()->create(['work_item_id' => $item->id, 'user_id' => $ida->id, 'reason' => 'manual', 'unsubscribed_at' => now()]);
    $lene = memberOf($project, ProjectRole::Member);

    $assigned = $update($mara, $item, ['assignee_id' => strtoupper($ida->id), 'title' => 'Für Ida']);
    $event = eventsOf(EventType::WorkItemAssigned, $item)->sole();
    $watch = fn (User $user) => WorkItemSubscriber::query()->where('work_item_id', $item->id)->where('user_id', $user->id)->first();

    expect($assigned->assignee_id)->toBe($ida->id)
        ->and($event->changes)->toBe(['assignee_id' => ['old' => null, 'new' => $ida->id]])
        ->and(eventsOf(EventType::WorkItemUpdated, $item)->sole()->changes)->toBe(['title' => ['old' => 'Formular prüfen', 'new' => 'Für Ida']])
        ->and($watch($ida)?->only('reason', 'unsubscribed_at'))->toBe(['reason' => 'assigned', 'unsubscribed_at' => null]);

    // the same assignee again is no change; one who watches already keeps their reason
    $update($mara, $item, ['assignee_id' => $ida->id]);
    WorkItemSubscriber::query()->create(['work_item_id' => $item->id, 'user_id' => $lene->id, 'reason' => 'manual']);
    $update($ida, $item, ['assignee_id' => $lene->id]);

    expect(eventsOf(EventType::WorkItemAssigned, $item))->toHaveCount(2)
        ->and($watch($lene)?->reason)->toBe('manual')
        ->and(invalidOf(fn () => $update($mara, $item, ['assignee_id' => User::factory()->create()->id])))->toBe(['assignee_id' => [__('field.assignee_id.invalid')]]);
});

it('keeps an assignee who could not be picked anymore, and lets a bot take the item without watching it', function () use ($web, $update) {
    [$project, $mara, $ida, $item] = $web();
    $item->forceFill(['assignee_id' => $ida->id])->save();
    $ida->forceFill(['disabled_at' => now()])->save();
    $bot = User::factory()->bot()->create();
    app(RoleAssignments::class)->setProjectRole($bot, $project, ProjectRole::Member);

    $kept = $update($mara, $item, ['assignee_id' => $ida->id, 'title' => 'Noch Ida']);
    $taken = $update($mara, $item, ['assignee_id' => $bot->id]);

    expect($kept->assignee_id)->toBe($ida->id)
        ->and($taken->assignee_id)->toBe($bot->id)
        ->and(WorkItemSubscriber::query()->where('user_id', $bot->id)->exists())->toBeFalse();
});

it('takes an empty assignee', function () use ($web, $update) {
    [, $mara, $ida, $item] = $web();
    $item->forceFill(['assignee_id' => $ida->id, 'updated_at' => now()->subDay()])->save();

    $released = $update($mara, $item, ['assignee_id' => null]);

    expect($released->assignee_id)->toBeNull()
        ->and($released->updated_at?->isToday())->toBeTrue()
        ->and(eventsOf(EventType::WorkItemAssigned, $item)->sole()->changes)->toBe(['assignee_id' => ['old' => $ida->id, 'new' => null]])
        ->and(eventsOf(EventType::WorkItemUpdated, $item))->toHaveCount(0);
});

it('refuses an archived item', function () use ($web, $update) {
    [$project, $mara] = $web();
    $archived = WorkItem::factory()->for($project)->archived()->create();

    $problem = problemOf(fn () => $update($mara, $archived, ['title' => '']));

    expect([$problem->status, $problem->reason, $problem->detail])->toBe([409, 'archived', __('problem.detail.item_archived', ['key' => 'WEB-2'])])
        ->and(__('problem.detail.item_archived', ['key' => 'WEB-2'], 'de'))->toBe('WEB-2 ist archiviert und schreibgeschützt. Stelle es zuerst wieder her.');
});

it('refuses an item of an archived project', function () use ($web, $update) {
    [$project, $mara, , $item] = $web();
    $project->update(['archived_at' => now()]);

    $problem = problemOf(fn () => $update($mara, $item, ['title' => 'Neu']));

    expect([$problem->status, $problem->reason])->toBe([409, 'project_archived']);
});

it('refuses a parent that is the item itself', function () use ($web, $update) {
    [$project, $mara, , $item] = $web();
    $epic = WorkItem::factory()->for($project)->epic()->create();
    $other = WorkItem::factory()->for($project)->create();
    $ops = Project::factory()->identifier('OPS')->member($mara, ProjectRole::Member)->create();
    $foreign = WorkItem::factory()->for($ops)->epic()->create();

    $child = $update($mara, $item, ['parent_id' => 'web-2']);

    expect($child->parent_id)->toBe($epic->id)
        ->and($child->parent?->key)->toBe('WEB-2')
        ->and(eventsOf(EventType::WorkItemUpdated, $item)->sole()->changes)->toBe(['parent_id' => ['old' => null, 'new' => $epic->id]])
        ->and(invalidOf(fn () => $update($mara, $item, ['parent_id' => 'WEB-1'])))->toBe(['parent_id' => [__('field.parent_id.self')]])
        ->and(invalidOf(fn () => $update($mara, $epic, ['parent_id' => $epic->id])))->toBe(['parent_id' => [__('field.parent_id.self')]])
        ->and(__('field.parent_id.self', [], 'de'))->toBe('Ein Item kann nicht sein eigenes Eltern-Item sein.')
        ->and(invalidOf(fn () => $update($mara, $item, ['parent_id' => $foreign->key])))->toBe(['parent_id' => [__('field.parent_id.project')]])
        ->and(invalidOf(fn () => $update($mara, $item, ['parent_id' => 'WEB-99'])))->toBe(['parent_id' => [__('field.parent_id.unknown')]])
        ->and(problemOf(fn () => $update($mara, $item, ['parent_id' => $other->id]))->reason)->toBe('parent_not_epic')
        // the parent it has already is no new pick
        ->and($update($mara, $item, ['parent_id' => $epic->id])->parent_id)->toBe($epic->id)
        ->and($update($mara, $item, ['parent_id' => null])->parent_id)->toBeNull();
});

it('moves an item by rank and refuses a malformed rank', function () use ($web, $update) {
    [, $mara, , $item] = $web();
    $old = $item->rank;

    $moved = $update($mara, $item, ['rank' => 'a0V']);

    expect($moved->rank)->toBe('a0V')
        ->and(eventsOf(EventType::WorkItemUpdated, $item)->sole()->changes)->toBe(['rank' => ['old' => $old, 'new' => 'a0V']])
        ->and(__('field.rank.invalid', [], 'de'))->toBe('Der Rang ist ungültig.');

    foreach (['a00', '', 12, null, 'a0'.str_repeat('V', 127)] as $rank) {
        expect(invalidOf(fn () => $update($mara, $item, ['rank' => $rank])))->toBe(['rank' => [__('field.rank.invalid')]]);
    }
});

it('names every field error in one answer', function () use ($web, $update, $askFor) {
    [, $mara, , $item] = $web();
    $askFor(Property::factory()->create(['key' => 'notes', 'label' => 'Notizen', 'field_type' => FieldType::RichText]));

    expect(invalidOf(fn () => $update($mara, $item, [
        'title' => ' ',
        'description_json' => ['type' => 'nonsense'],
        'base_description_version' => '2',
        'priority' => null,
        'values' => ['notes' => ['type' => 'nonsense']],
    ])))->toBe([
        'description_json' => [__('field.rich_text.invalid')],
        'values.notes' => [__('field.values.rich_text', ['label' => 'Notizen'])],
        'title' => [__('field.title.required')],
        'base_description_version' => [__('field.base_description_version.invalid')],
        'priority' => [__('field.priority.invalid')],
    ])
        ->and(invalidOf(fn () => $update($mara, $item, ['base_description_version' => 0])))->toBe(['base_description_version' => [__('field.base_description_version.invalid')]])
        ->and($update($mara, $item, ['base_description_version' => null])->description_version)->toBe(1);
});

it('notes the reason of a bulk edit in its events', function () use ($web) {
    [, $mara, $ida, $item] = $web();

    $changed = UpdateWorkItem::apply(actor($mara, Actor::VIA_API), ItemLock::take($item), ['title' => 'Neu', 'assignee_id' => $ida->id], 'bulk');

    expect($changed)->toBeTrue()
        ->and(eventsOf(EventType::WorkItemUpdated, $item)->sole()->meta)->toBe(['via' => 'api', 'reason' => 'bulk'])
        ->and(eventsOf(EventType::WorkItemAssigned, $item)->sole()->meta)->toBe(['via' => 'api', 'reason' => 'bulk']);
});

it('answers 403 to a viewer and 404 to an outsider of a private project', function () use ($web, $update) {
    [$project, $mara, , $item] = $web();
    $viewer = memberOf($project, ProjectRole::Viewer);
    $ops = Project::factory()->identifier('OPS')->private()->member($mara, ProjectRole::Admin)->create();
    $secret = WorkItem::factory()->for($ops)->create();

    $refused = problemOf(fn () => $update($viewer, $item, ['title' => '']));
    $hidden = problemOf(fn () => $update($viewer, $secret, ['title' => '']));

    expect([$refused->status, $refused->detail])->toBe([403, __('problem.detail.items_members_only')])
        ->and([$hidden->status, $hidden->detail])->toBe([404, null]);
});

it('acts on an item named by a former key', function () use ($web) {
    [$project, $mara, , $item] = $web();
    $project->update(['identifier' => 'NEW']);
    $project->identifiers()->create(['identifier' => 'OLD']);

    $this->actingAs($mara)->patchJson('/api/v1/work-items/OLD-1', ['title' => 'Umbenannt'])
        ->assertOk()->assertHeaderMissing('Location')
        ->assertJsonPath('data.key', 'NEW-1')
        ->assertJsonPath('data.title', 'Umbenannt');

    expect($item->fresh()?->title)->toBe('Umbenannt');
});

it('moves an item with state_id in a patch, after its fields', function () use ($web, $update) {
    [$project, $mara, , $item] = $web();
    $done = $project->workflow()->firstOrFail()->states()->where('name', 'Done')->value('id');
    $duplicate = Resolution::query()->where('label', 'Duplicate')->value('id');

    $changed = $update($mara, $item, ['title' => 'Formular erledigt', 'state_id' => strtoupper((string) $done), 'resolution_id' => $duplicate]);
    $history = Event::query()->where('subject_id', $item->id)->orderBy('occurred_at')->orderBy('id')->get();

    expect([$changed->title, $changed->state_id, $changed->resolution_id])->toBe(['Formular erledigt', $done, $duplicate])
        ->and($changed->closed_at)->not->toBeNull()
        ->and($history->pluck('type')->all())->toBe([EventType::WorkItemUpdated, EventType::WorkItemStateChanged])
        ->and($history[0]->changes)->toBe(['title' => ['old' => 'Formular prüfen', 'new' => 'Formular erledigt']])
        ->and($history[1]->changes)->toBe([
            'state_id' => ['old' => $item->state_id, 'new' => $done],
            'resolution_id' => ['old' => null, 'new' => $duplicate],
        ]);
});

it('changes the resolution alone in a patch, and tells whether a move changed anything', function () use ($web) {
    [$project, $mara] = $web();
    $closed = WorkItem::factory()->for($project)->closed()->create();
    $duplicate = Resolution::query()->where('label', 'Duplicate')->value('id');
    $apply = fn (array $input) => DB::transaction(fn () => UpdateWorkItem::apply(actor($mara), ItemLock::take($closed), $input));

    expect($apply(['resolution_id' => $duplicate]))->toBeTrue()
        ->and($apply(['resolution_id' => $duplicate, 'state_id' => $closed->state_id]))->toBeFalse()
        ->and($apply(['resolution_id' => null]))->toBeFalse()
        ->and($closed->fresh()?->resolution_id)->toBe($duplicate)
        ->and(eventsOf(EventType::WorkItemUpdated, $closed)->sole()->changes)->toBe(['resolution_id' => ['old' => $closed->resolution_id, 'new' => $duplicate]])
        ->and(invalidOf(fn () => $apply(['state_id' => null])))->toBe(['state_id' => [__('field.state_id.unknown')]]);
});

it('refuses the whole patch when the move is not allowed', function () use ($web, $update) {
    [$project, $mara, , $item] = $web();
    $this->seed(CatalogSeeder::class);
    $agency = Workflow::query()->where('name', 'Agentur-Freigabe')->firstOrFail();
    $project->update(['workflow_id' => $agency->id]);
    $item->update(['state_id' => $agency->states()->where('name', 'Todo')->value('id')]);
    $archived = Resolution::factory()->create(['archived_at' => now()]);

    $refused = problemOf(fn () => $update($mara, $item, ['title' => 'Neu', 'state_id' => $agency->states()->where('name', 'Done')->value('id')]));
    $invalid = invalidOf(fn () => $update($mara, $item, ['title' => 'Neu', 'state_id' => $agency->states()->where('name', 'Cancelled')->value('id'), 'resolution_id' => $archived->id]));

    // apply() checks the move before its first change: a caller that goes on after a refusal (a bulk edit) keeps nothing
    $kept = DB::transaction(function () use ($mara, $item, $agency) {
        try {
            UpdateWorkItem::apply(actor($mara), ItemLock::take($item), ['title' => 'Neu', 'state_id' => $agency->states()->where('name', 'Done')->value('id')]);
        } catch (Problem $problem) {
            return $problem->reason;
        }
    });

    expect([$refused->status, $refused->reason])->toBe([409, 'transition_not_allowed'])
        ->and($invalid)->toBe(['resolution_id' => [__('field.resolution_id.archived')]])
        ->and($kept)->toBe('transition_not_allowed')
        ->and($item->fresh()?->title)->toBe('Formular prüfen')
        ->and(Event::query()->where('subject_id', $item->id)->count())->toBe(0);
});
