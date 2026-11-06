<?php

namespace App\Http\Resources;

use App\Models\Organization;
use App\Support\ImageInput;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

/**
 * The organization as `Organization` of resources/js/types.ts.
 *
 * @mixin Organization
 */
final class OrganizationResource extends JsonResource
{
    /**
     * @return array<string, mixed>
     */
    public function toArray(Request $request): array
    {
        /** @var Organization $organization */
        $organization = $this->resource;

        return [
            'id' => $organization->id,
            'name' => $organization->name,
            'locale' => $organization->locale->value,
            'timezone' => $organization->timezone,
            'week_start' => $organization->week_start,
            /** @format uri */
            'logo_url' => ImageInput::url($organization, 'logo'),
        ];
    }
}
