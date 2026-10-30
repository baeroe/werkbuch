<?php

namespace App\Http\Resources;

use App\Models\Invitation;
use App\Support\InvitationLinks;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

/**
 * An invitation as `Invitation` of resources/js/types.ts. The link is derived from the invitation (it can be shown again
 * at any time), `created_by` is the inviting account.
 *
 * @mixin Invitation
 */
final class InvitationResource extends JsonResource
{
    /**
     * @return array<string, mixed>
     */
    public function toArray(Request $request): array
    {
        /** @var Invitation $invitation */
        $invitation = $this->resource;

        return [
            'id' => $invitation->id,
            'email' => $invitation->email,
            'org_role' => $invitation->org_role->value,
            'projects' => $invitation->projects,
            'link' => InvitationLinks::for($invitation),
            'created_by' => $invitation->invited_by,
            'created_at' => $invitation->created_at?->toJSON(),
            'expires_at' => $invitation->expires_at->toJSON(),
        ];
    }
}
