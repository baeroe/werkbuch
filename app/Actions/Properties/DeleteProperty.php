<?php

namespace App\Actions\Properties;

use App\Access\Authorize;
use App\Enums\Catalog;
use App\Events\EventRecorder;
use App\Events\EventType;
use App\Exceptions\Problem;
use App\Models\Organization;
use App\Models\Property;
use App\Models\WorkItemType;
use App\Models\WorkItemValue;
use App\Support\Actor;
use App\Support\CatalogLock;
use Illuminate\Support\Facades\DB;
use Lorisleiva\Actions\Concerns\AsAction;

/**
 * Deletes a property with its options and takes it off the types that ask for it (org admins). The cascade writes no
 * event of its own: `property.deleted` names the types in `meta.types` (P26). The values of the items go with it (the
 * history keeps what they were; no event per item) and the answer is the number of items that had a value, counted
 * under the catalog lock before the delete.
 */
final class DeleteProperty
{
    use AsAction;

    /**
     * @throws Problem 404 for a property deleted meanwhile
     */
    public function handle(Actor $actor, Property $property): int
    {
        Authorize::check($actor, 'manageCatalog', Organization::class, Catalog::Properties);

        return DB::transaction(function () use ($actor, $property): int {
            CatalogLock::take();

            $property = Property::query()->find($property->id) ?? throw Problem::notFound();

            $items = WorkItemValue::query()->where('property_id', $property->id)->distinct()->count('work_item_id');

            $types = WorkItemType::query()
                ->whereHas('typeProperties', fn ($query) => $query->where('property_id', $property->id))
                ->orderBy('name')->orderBy('id')->pluck('name')->all();

            EventRecorder::record(EventType::PropertyDeleted, $actor, $property, null, meta: [
                'key' => $property->key,
                'label' => $property->label,
                'types' => $types,
            ]);
            $property->delete();

            return $items;
        });
    }
}
