<?php

namespace App\Http\Resources;

use App\Models\TypeProperty;
use App\Models\WorkItemType;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

/**
 * A work item type as `WorkItemType` of resources/js/types.ts, with the properties it asks for in order.
 *
 * @mixin WorkItemType
 */
final class WorkItemTypeResource extends JsonResource
{
    /**
     * @return array<string, mixed>
     */
    public function toArray(Request $request): array
    {
        /** @var WorkItemType $type */
        $type = $this->resource;

        return [
            'id' => $type->id,
            'name' => $type->name,
            'icon' => $type->icon,
            'tone' => $type->tone->value,
            'description' => $type->description,
            'is_epic' => $type->is_epic,
            'properties' => $type->typeProperties->map(fn (TypeProperty $row) => [
                'property_id' => $row->property_id,
                'required' => $row->required,
                'position' => $row->position,
            ])->values()->all(),
            'archived_at' => $type->archived_at?->toJSON(),
        ];
    }
}
