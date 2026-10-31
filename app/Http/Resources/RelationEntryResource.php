<?php

namespace App\Http\Resources;

use App\Actions\WorkItems\ListRelations;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

/**
 * One relation of a work item as its reader sees it, the entry ListRelations built (`RelationEntry` in
 * resources/js/types.ts): the relation, the item at the other end (WorkItemResource), the direction from this item and
 * whether the other end is hidden. A hidden end leaves nothing behind (P19): `other` is `null` and its id in the
 * relation is `''` (`target_id` when this item is the source, `source_id` when it is the target); the relation's own
 * `id` and `type_id` stay. It asks the database nothing: ListRelations loaded everything for the reader (K5).
 *
 * @phpstan-import-type RelationEntry from ListRelations
 */
final class RelationEntryResource extends JsonResource
{
    /**
     * @return array<string, mixed>
     */
    public function toArray(Request $request): array
    {
        /** @var RelationEntry $entry */
        $entry = $this->resource;
        $relation = $entry['relation'];
        $hidden = $entry['hidden'];
        $outward = $entry['direction'] === 'outward';

        return [
            'relation' => [
                'id' => $relation->id,
                'type_id' => $relation->type_id,
                'source_id' => $hidden && ! $outward ? '' : $relation->source_id,
                'target_id' => $hidden && $outward ? '' : $relation->target_id,
            ],
            'other' => $hidden || $entry['other'] === null ? null : (new WorkItemResource($entry['other']))->resolve($request),
            'direction' => $entry['direction'],
            'hidden' => $hidden,
        ];
    }
}
