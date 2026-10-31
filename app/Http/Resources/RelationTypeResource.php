<?php

namespace App\Http\Resources;

use App\Models\RelationType;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

/**
 * A relation type as `RelationType` of resources/js/types.ts.
 *
 * @mixin RelationType
 */
final class RelationTypeResource extends JsonResource
{
    /**
     * @return array<string, mixed>
     */
    public function toArray(Request $request): array
    {
        /** @var RelationType $type */
        $type = $this->resource;

        return [
            'id' => $type->id,
            'name' => $type->name,
            'outward_label' => $type->outward_label,
            'inward_label' => $type->inward_label,
            'built_in' => $type->built_in,
        ];
    }
}
