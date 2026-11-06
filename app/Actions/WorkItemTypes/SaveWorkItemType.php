<?php

namespace App\Actions\WorkItemTypes;

use App\Access\Authorize;
use App\Enums\Catalog;
use App\Events\EventRecorder;
use App\Events\EventType;
use App\Exceptions\Problem;
use App\Models\Organization;
use App\Models\TypeProperty;
use App\Models\WorkItem;
use App\Models\WorkItemType;
use App\Support\Actor;
use App\Support\CatalogInput;
use App\Support\CatalogLock;
use App\Support\TypeInput;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\ValidationException;
use Lorisleiva\Actions\Concerns\AsAction;

/**
 * Creates a work item type or replaces one as a whole (P4, P24): name, icon, tone, description, the epic mark, the
 * properties it asks for in order and the archive stamp (org admins). Archiving stamps the time itself; a type that is
 * archived already keeps its stamp (P25). The default type of a project is never archived (P11). Runs under the catalog
 * lock, so the name and the default types are checked against what the change before left. Only what really changes is
 * written and recorded; the same input again writes nothing. The epic mark must fit the items of the type (spec 4.8),
 * checked under the lock.
 */
final class SaveWorkItemType
{
    use AsAction;

    /** The keys of the input the action reads (the OpenAPI document holds its body against them). */
    public const FIELDS = ['name', 'icon', 'tone', 'description', 'is_epic', 'properties', 'archived_at'];

    /**
     * @param  array<array-key, mixed>  $input  `name`, `icon`, `tone`, `description`, `is_epic`, `properties`, `archived_at`
     *
     * @throws ValidationException
     * @throws Problem 409 `default_type` with the identifiers of the projects, 404 for a type deleted meanwhile
     */
    public function handle(Actor $actor, ?WorkItemType $type, array $input): WorkItemType
    {
        Authorize::check($actor, 'manageCatalog', Organization::class, Catalog::WorkItemTypes);

        $input = TypeInput::normalize($input);

        return DB::transaction(function () use ($actor, $type, $input): WorkItemType {
            CatalogLock::take();

            $current = $type === null
                ? null
                : WorkItemType::query()->with('typeProperties')->find($type->id) ?? throw Problem::notFound();

            $valid = TypeInput::validate($input, $current);

            // only on the way into the archive: saving a type archived before archives nothing, so it refuses nothing
            if ($current !== null && $current->archived_at === null && $valid['archived']) {
                TypeInput::refuseDefaultType($current);
            }

            if ($current !== null && $current->is_epic !== $valid['is_epic']) {
                self::checkEpicMark($current, $valid['is_epic']);
            }

            $before = $current === null ? null : self::snapshot($current);

            $saved = $current ?? new WorkItemType;
            $saved->fill([
                'name' => $valid['name'],
                'icon' => $valid['icon'],
                'tone' => $valid['tone'],
                'description' => $valid['description'],
                'is_epic' => $valid['is_epic'],
                'archived_at' => CatalogInput::archivedStamp($saved->archived_at, $valid['archived']),
            ])->save();

            // the properties: a row per property, kept where it was, changed in place, the others go
            $rows = $current === null ? [] : $current->typeProperties->keyBy('property_id')->all();

            foreach ($valid['properties'] as $position => $property) {
                $row = $rows[$property['property_id']] ?? new TypeProperty(['type_id' => $saved->id, 'property_id' => $property['property_id']]);
                $row->fill(['required' => $property['required'], 'position' => $position])->save();
                unset($rows[$property['property_id']]);
            }

            if ($rows !== []) {
                TypeProperty::query()->whereKey(array_map(fn (TypeProperty $row) => $row->id, array_values($rows)))->delete();
            }

            // the properties as they are now, not as they were read before the writes
            $saved->load('typeProperties');

            if ($before === null) {
                EventRecorder::record(EventType::WorkItemTypeCreated, $actor, $saved, null, ['name' => ['old' => null, 'new' => $saved->name]]);

                return $saved;
            }

            $changes = CatalogInput::changes($before, self::snapshot($saved));

            if ($changes !== []) {
                if (! $saved->wasChanged()) {
                    // only the properties changed: the type changed all the same
                    $saved->touch();
                }

                EventRecorder::record(EventType::WorkItemTypeUpdated, $actor, $saved, null, $changes);
            }

            return $saved;
        });
    }

    /**
     * The epic mark keeps the items in two levels (spec 4.8): it goes only while no item of the type has children, and
     * comes only while none has a parent. Archived items count, they keep their place.
     *
     * @throws ValidationException 422 `is_epic`
     */
    private static function checkEpicMark(WorkItemType $type, bool $isEpic): void
    {
        $items = fn () => WorkItem::query()->where('type_id', $type->id);

        if ($isEpic && $items()->whereNotNull('parent_id')->exists()) {
            throw ValidationException::withMessages(['is_epic' => __('field.is_epic.has_parent')]);
        }

        if (! $isEpic && $items()->whereExists(fn ($children) => $children->from('work_items as children')->whereColumn('children.parent_id', 'work_items.id'))->exists()) {
            throw ValidationException::withMessages(['is_epic' => __('field.is_epic.has_children')]);
        }
    }

    /**
     * What an event compares: the fields, the properties in order and the archive stamp.
     *
     * @return array{name: string, icon: string, tone: string, description: string, is_epic: bool, properties: list<array{property_id: string, required: bool}>, archived_at: ?string}
     */
    private static function snapshot(WorkItemType $type): array
    {
        return [
            'name' => $type->name,
            'icon' => $type->icon,
            'tone' => $type->tone->value,
            'description' => $type->description,
            'is_epic' => $type->is_epic,
            'properties' => array_values($type->typeProperties->map(fn (TypeProperty $row) => [
                'property_id' => $row->property_id,
                'required' => $row->required,
            ])->all()),
            'archived_at' => $type->archived_at?->toJSON(),
        ];
    }
}
