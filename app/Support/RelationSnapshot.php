<?php

namespace App\Support;

use App\Models\WorkItem;
use App\Models\WorkItemRelation;
use InvalidArgumentException;

/**
 * A relation as one of its ends reads it, frozen into an event (`changes.relation` of `work_item.relation_added` and
 * `work_item.relation_removed`, P11): the type, the direction from this end (`outward` at the source, `inward` at the
 * target), the label of that direction as it reads now (a type without an inward label reads the same from both ends)
 * and the id of the other end. The label stays as it was even when the type is renamed later.
 */
final class RelationSnapshot
{
    /**
     * @return array{relation_type_id: string, direction: 'outward'|'inward', label: string, item_id: string}
     *
     * @throws InvalidArgumentException when `$end` is neither end of the relation
     */
    public static function of(WorkItemRelation $relation, WorkItem $end): array
    {
        $type = $relation->type;

        if ($end->id === $relation->source_id) {
            return ['relation_type_id' => $type->id, 'direction' => 'outward', 'label' => $type->outward_label, 'item_id' => $relation->target_id];
        }
        if ($end->id === $relation->target_id) {
            return ['relation_type_id' => $type->id, 'direction' => 'inward', 'label' => $type->inward_label ?? $type->outward_label, 'item_id' => $relation->source_id];
        }

        throw new InvalidArgumentException("Item [{$end->id}] is no end of relation [{$relation->id}].");
    }
}
