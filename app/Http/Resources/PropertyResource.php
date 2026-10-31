<?php

namespace App\Http\Resources;

use App\Models\Property;
use App\Models\PropertyOption;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

/**
 * A property as `Property` of resources/js/types.ts: the options in order, the settings always as an object (an empty
 * PHP array would come out as `[]`).
 *
 * @mixin Property
 */
final class PropertyResource extends JsonResource
{
    /**
     * @return array<string, mixed>
     */
    public function toArray(Request $request): array
    {
        /** @var Property $property */
        $property = $this->resource;

        return [
            'id' => $property->id,
            'key' => $property->key,
            'label' => $property->label,
            'field_type' => $property->field_type->value,
            'help' => $property->help,
            'default_value' => $property->default_value,
            'settings' => (object) $property->settings,
            'options' => $property->options->map(fn (PropertyOption $option) => [
                'id' => $option->id,
                'label' => $option->label,
                'color' => $option->color->value,
                'position' => $option->position,
                'archived_at' => $option->archived_at?->toJSON(),
            ])->values()->all(),
        ];
    }
}
