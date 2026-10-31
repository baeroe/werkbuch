<?php

namespace App\Http\Resources;

use App\Models\Favorite;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

/**
 * A favorite as `Favorite` of resources/js/types.ts: `kind` is the morph alias of what it points to, `id` its ULID.
 *
 * @mixin Favorite
 */
final class FavoriteResource extends JsonResource
{
    /**
     * @return array<string, mixed>
     */
    public function toArray(Request $request): array
    {
        /** @var Favorite $favorite */
        $favorite = $this->resource;

        return [
            'user_id' => $favorite->user_id,
            'kind' => $favorite->favoritable_type,
            'id' => $favorite->favoritable_id,
            'position' => $favorite->position,
        ];
    }
}
