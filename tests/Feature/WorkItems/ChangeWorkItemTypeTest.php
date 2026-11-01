<?php

use App\Access\ProjectRole;
use App\Actions\WorkItems\ChangeWorkItemType;
use App\Actions\WorkItems\CreateWorkItem;
use App\Domain\Properties\FieldType;
use App\Events\EventType;
use App\Models\Project;
use App\Models\Property;
use App\Models\User;
use App\Models\WorkItem;
use App\Models\WorkItemType;
use App\Models\WorkItemValue;
use App\Support\ItemValues;

$type = fn (string $name): WorkItemType => WorkItemType::query()->where('name', $name)->firstOrFail();

/** WEB with Mara as its admin and lead, and a Bug of hers with an effort of 2.5 hours. */
$web = function () use ($type): array {
    $mara = User::factory()->create(['name' => 'Mara']);
    $web = Project::factory()->identifier('WEB')->member($mara, ProjectRole::Admin)->create(['lead_id' => $mara->id]);
    $bug = CreateWorkItem::run(actor($mara), ['project_id' => $web->id, 'title' => 'Absturz', 'type_id' => $type('Bug')->id, 'values' => ['effort' => 2.5]]);

    return [$web, $mara, $bug];
};

/** A property the type asks for, at the end of its list. */
$askFor = function (WorkItemType $type, Property $property, bool $required = false): Property {
    $type->typeProperties()->create(['property_id' => $property->id, 'required' => $required, 'position' => $type->typeProperties()->count()]);

    return $property;
};

$change = fn (User $user, WorkItem $item, mixed $typeId, array $values = []): WorkItem => ChangeWorkItemType::run(actor($user), $item, ['type_id' => $typeId, 'values' => $values]);

$values = fn (WorkItem $item): array => ItemValues::of($item->fresh()?->load('values.property') ?? $item);

it('drops the values the new type lacks and keeps them in the history', function () use ($web, $type, $change, $values) {
    [, $mara, $bug] = $web();
    $bug->forceFill(['updated_at' => now()->subDay()])->save();

    $task = $change($mara, $bug, $type('Task')->id);
    $event = eventsOf(EventType::WorkItemUpdated, $bug)->sole();

    expect($task->type_id)->toBe($type('Task')->id)
        ->and($task->values)->toBeEmpty()
        ->and($task->updated_at?->isToday())->toBeTrue()
        ->and($values($bug))->toBe([])
        ->and(WorkItemValue::query()->where('work_item_id', $bug->id)->count())->toBe(0)
        ->and($event->changes)->toBe([
            'type_id' => ['old' => $type('Bug')->id, 'new' => $type('Task')->id],
            'values.effort' => ['old' => 2.5, 'new' => null],
        ])
        ->and($event->actor_id)->toBe($mara->id)
        ->and($event->project_id)->toBe($bug->project_id);
});

it('requires the required values of the new type', function () use ($web, $type, $askFor, $change, $values) {
    [, $mara, $bug] = $web();
    $askFor($type('Task'), Property::factory()->create(['key' => 'customer', 'label' => 'Kunde']), true);

    $errors = invalidOf(fn () => $change($mara, $bug, $type('Task')->id));
    $empty = invalidOf(fn () => $change($mara, $bug, $type('Task')->id, ['customer' => '  ']));

    expect($errors)->toBe(['values.customer' => [__('field.values.required', ['label' => 'Kunde'])]])
        ->and($empty)->toBe(['values.customer' => [__('field.values.required', ['label' => 'Kunde'])]])
        ->and($bug->fresh()?->type_id)->toBe($type('Bug')->id)
        ->and($values($bug))->toBe(['effort' => 2.5])
        ->and(eventsOf(EventType::WorkItemUpdated))->toBeEmpty();
});

it('takes the values sent with the change', function () use ($web, $type, $askFor, $change, $values) {
    [, $mara, $bug] = $web();
    $task = $type('Task');
    $askFor($task, Property::factory()->create(['key' => 'customer', 'label' => 'Kunde']), true);
    $askFor($task, Property::factory()->create(['key' => 'notes', 'label' => 'Notizen', 'field_type' => FieldType::RichText]));
    // the effort the item has stays, even though the property has a default; a new property nobody fills takes its own
    $askFor($task, Property::query()->where('key', 'effort')->firstOrFail())->update(['default_value' => 1]);
    $askFor($task, Property::factory()->create(['key' => 'channel', 'default_value' => 'Web']));

    $changed = $change($mara, $bug, strtoupper($task->id), ['customer' => 'Feldwerk', 'notes' => '**Wichtig**']);
    $event = eventsOf(EventType::WorkItemUpdated, $bug)->sole();

    expect($changed->type_id)->toBe($task->id)
        ->and($values($bug))->toMatchArray(['effort' => 2.5, 'customer' => 'Feldwerk', 'channel' => 'Web'])
        ->and(ItemValues::markdown($changed))->toBe(['notes' => '**Wichtig**'])
        ->and(array_keys($event->changes))->toBe(['type_id', 'values.channel', 'values.customer', 'values.notes'])
        ->and($event->changes['values.customer'])->toBe(['old' => null, 'new' => 'Feldwerk'])
        ->and($event->changes['values.channel'])->toBe(['old' => null, 'new' => 'Web']);
});

it('reports rich text it cannot read together with the other field errors', function () use ($web, $type, $askFor, $change) {
    [, $mara, $bug] = $web();
    $askFor($type('Task'), Property::factory()->create(['key' => 'customer', 'label' => 'Kunde']), true);
    $askFor($type('Task'), Property::factory()->create(['key' => 'notes', 'label' => 'Notizen', 'field_type' => FieldType::RichText]));

    $errors = invalidOf(fn () => $change($mara, $bug, $type('Task')->id, ['notes' => ['type' => 'iframe']]));

    expect($errors)->toBe([
        'values.notes' => [__('field.values.rich_text', ['label' => 'Notizen'])],
        'values.customer' => [__('field.values.required', ['label' => 'Kunde'])],
    ])
        ->and(invalidOf(fn () => $change($mara, $bug, $type('Task')->id, ['x'])))->toBe([
            'values' => [__('field.values.invalid')],
            'values.customer' => [__('field.values.required', ['label' => 'Kunde'])],
        ])
        ->and(invalidOf(fn () => $change($mara, $bug, $type('Task')->id, ['effort' => 1, 'unknown' => 1])))->toHaveKey('values.unknown');
});

it('keeps two levels', function () use ($web, $type, $change) {
    [$project, $mara] = $web();
    $epic = WorkItem::factory()->for($project)->epic()->create();
    $child = WorkItem::factory()->childOf($epic)->create();

    $parentless = problemOf(fn () => $change($mara, $epic, $type('Task')->id));
    $childEpic = problemOf(fn () => $change($mara, $child, $epic->type_id));

    expect([$parentless->status, $parentless->reason, $parentless->errors])
        ->toBe([422, 'parent_not_epic', ['type_id' => [__('items.hierarchy.has_children', ['key' => $epic->key])]]])
        ->and([$childEpic->status, $childEpic->reason, $childEpic->errors])
        ->toBe([422, 'epic_has_no_parent', ['type_id' => [__('items.hierarchy.has_parent', ['key' => $child->key])]]])
        ->and(__('items.hierarchy.has_children', ['key' => 'WEB-2'], 'de'))->toBe('WEB-2 hat Kind-Items. Nur Epics können Kind-Items haben.')
        ->and($epic->fresh()?->type_id)->toBe($epic->type_id)
        ->and($child->fresh()?->type_id)->toBe($child->type_id)
        // an epic without children and an item without a parent may change either way
        ->and($change($mara, WorkItem::factory()->for($project)->create(), $epic->type_id)->type_id)->toBe($epic->type_id)
        ->and($change($mara, $child, $type('Bug')->id)->type_id)->toBe($type('Bug')->id);
});

it('refuses a type the project has not switched on', function () use ($web, $type, $change) {
    [$project, $mara, $bug] = $web();
    $off = WorkItemType::factory()->create();
    $archived = WorkItemType::factory()->create();
    $project->types()->attach($archived->id);
    $archived->update(['archived_at' => now()]);

    expect(invalidOf(fn () => $change($mara, $bug, $off->id)))->toBe(['type_id' => [__('field.type_id.disabled')]])
        ->and(invalidOf(fn () => $change($mara, $bug, $archived->id)))->toBe(['type_id' => [__('field.type_id.archived')]])
        ->and(invalidOf(fn () => $change($mara, $bug, 'Task')))->toBe(['type_id' => [__('field.type_id.disabled')]])
        ->and(invalidOf(fn () => $change($mara, $bug, null)))->toBe(['type_id' => [__('field.type_id.disabled')]])
        ->and($bug->fresh()?->type_id)->toBe($type('Bug')->id);
});

it('does nothing for the same type', function () use ($web, $type, $change, $values) {
    [, $mara, $bug] = $web();
    $bug->forceFill(['updated_at' => now()->subDay()])->save();

    $same = $change($mara, $bug, strtoupper($type('Bug')->id), ['effort' => 4]);

    expect($same->type_id)->toBe($type('Bug')->id)
        ->and($same->relationLoaded('labels'))->toBeTrue()
        ->and($bug->fresh()?->updated_at?->isYesterday())->toBeTrue()
        ->and($values($bug))->toBe(['effort' => 2.5])
        ->and(eventsOf(EventType::WorkItemUpdated))->toBeEmpty();
});

it('refuses an archived item and an item of an archived project', function () use ($web, $type, $change) {
    [$project, $mara] = $web();
    $archived = WorkItem::factory()->for($project)->archived()->create();
    $item = WorkItem::factory()->for($project)->create();

    $refused = problemOf(fn () => $change($mara, $archived, $type('Bug')->id));
    $project->update(['archived_at' => now()]);
    $readOnly = problemOf(fn () => $change($mara, $item, $type('Bug')->id));

    expect([$refused->status, $refused->reason, $refused->detail])->toBe([409, 'archived', __('problem.detail.item_archived', ['key' => $archived->key])])
        ->and([$readOnly->status, $readOnly->reason])->toBe([409, 'project_archived'])
        ->and($archived->fresh()?->type_id)->toBe($archived->type_id);
});

it('answers 403 to a viewer and 404 to an outsider of a private project', function () use ($type, $change) {
    $ops = Project::factory()->identifier('OPS')->private()->create();
    $viewer = memberOf($ops, ProjectRole::Viewer);
    $item = WorkItem::factory()->for($ops)->create();

    expect(problemOf(fn () => $change($viewer, $item, $type('Bug')->id))->status)->toBe(403)
        ->and(problemOf(fn () => $change(User::factory()->create(), $item, $type('Bug')->id))->status)->toBe(404);
});
