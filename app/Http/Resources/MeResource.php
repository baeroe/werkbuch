<?php

namespace App\Http\Resources;

use App\Access\Grants;
use App\Access\Permission;
use App\Access\Visibility;
use App\Models\User;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

/**
 * The own account (`GET /me`): the account as UserResource shows it and, only here, `permissions`, the rights of its
 * role in the organization as the interface reads them (`auth.permissions`, lib/permissions.ts). They stay in `data`,
 * like every single resource (P27, K17).
 *
 * @mixin User
 */
final class MeResource extends JsonResource
{
    /**
     * @return array<string, mixed>
     */
    public function toArray(Request $request): array
    {
        /** @var User $user */
        $user = $this->resource;

        return [
            ...(new UserResource($user))->toArray($request),
            /** @var list<string> */
            'permissions' => array_map(fn (Permission $permission) => $permission->value, Grants::of(Visibility::orgRole($user))),
        ];
    }
}
