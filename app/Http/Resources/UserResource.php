<?php

namespace App\Http\Resources;

use App\Access\Visibility;
use App\Models\User;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

/**
 * An account as `User` of resources/js/types.ts: language and time zone are the effective ones, the description only
 * comes with bots. The role in the organization comes from the RoleIndex (one query for all accounts per request).
 *
 * @mixin User
 */
final class UserResource extends JsonResource
{
    /**
     * @return array<string, mixed>
     */
    public function toArray(Request $request): array
    {
        /** @var User $user */
        $user = $this->resource;

        return [
            'id' => $user->id,
            'type' => $user->type->value,
            'name' => $user->name,
            'handle' => $user->handle,
            'email' => $user->email,
            'org_role' => Visibility::orgRole($user)->value,
            'is_default_bot' => $user->is_default_bot,
            'owner_id' => $user->owner_id,
            'description' => $this->when($user->isBot(), fn () => (string) $user->description),
            'disabled_at' => $user->disabled_at?->toJSON(),
            // avatars arrive with the people (Task 8)
            'avatar_url' => null,
            'locale' => $user->effectiveLocale()->value,
            'timezone' => $user->effectiveTimezone(),
        ];
    }
}
