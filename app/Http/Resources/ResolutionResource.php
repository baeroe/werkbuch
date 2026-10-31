<?php

namespace App\Http\Resources;

use App\Models\Resolution;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

/**
 * A resolution as `Resolution` of resources/js/types.ts.
 *
 * @mixin Resolution
 */
final class ResolutionResource extends JsonResource
{
    /**
     * @return array<string, mixed>
     */
    public function toArray(Request $request): array
    {
        /** @var Resolution $resolution */
        $resolution = $this->resource;

        return [
            'id' => $resolution->id,
            'label' => $resolution->label,
            'default_for' => $resolution->default_for,
            'position' => $resolution->position,
            'archived_at' => $resolution->archived_at?->toJSON(),
        ];
    }
}
