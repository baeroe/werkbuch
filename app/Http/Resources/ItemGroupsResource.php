<?php

namespace App\Http\Resources;

use App\Domain\Views\GroupBy;
use App\Views\GroupCount;
use App\Views\ItemGroups;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

/**
 * The groups of a query (`POST /work-items/groups`): the grouping that holds, the number of all matches and each group
 * with its key and number; only groups by parent name their item (`{id, key, title, type_id}`, `null` for `none`). It
 * asks the database nothing.
 *
 * @mixin ItemGroups
 */
final class ItemGroupsResource extends JsonResource
{
    /**
     * @return array<string, mixed>
     */
    public function toArray(Request $request): array
    {
        /** @var ItemGroups $groups */
        $groups = $this->resource;
        $parents = $groups->groupBy === GroupBy::Parent;

        return [
            'group_by' => $groups->groupBy->value,
            'total' => $groups->total,
            'groups' => array_map(fn (GroupCount $group): array => [
                'key' => $group->key,
                'count' => $group->count,
                ...($parents ? ['item' => $group->item === null ? null : [
                    'id' => $group->item->id,
                    'key' => $group->item->key,
                    'title' => $group->item->title,
                    'type_id' => $group->item->type_id,
                ]] : []),
            ], $groups->groups),
        ];
    }
}
