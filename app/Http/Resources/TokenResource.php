<?php

namespace App\Http\Resources;

use App\Models\PersonalAccessToken;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

/**
 * An API token as `Token` of resources/js/types.ts: never its plain text, which only the answer of its creation carries.
 *
 * @mixin PersonalAccessToken
 */
final class TokenResource extends JsonResource
{
    /**
     * @return array<string, mixed>
     */
    public function toArray(Request $request): array
    {
        /** @var PersonalAccessToken $token */
        $token = $this->resource;

        return [
            'id' => $token->id,
            'user_id' => $token->tokenable_id,
            'name' => $token->name,
            'abilities' => $token->abilities,
            'expires_at' => $token->expires_at?->toJSON(),
            'last_used_at' => $token->last_used_at?->toJSON(),
            'created_at' => $token->created_at?->toJSON(),
        ];
    }
}
