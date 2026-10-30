<?php

namespace App\Http\Resources;

use App\Actions\Auth\CheckInvitation;
use App\Models\Invitation;
use App\Models\User;
use App\Support\InvitationLinks;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

/**
 * An invitation as `Invitation` of resources/js/types.ts. The link is derived from the invitation (it can be shown again
 * at any time), but only for the session of the interface and for tokens that may write: whoever holds the link can
 * make an account with the invited role, so a read-only token gets `null`. `state` is what CheckInvitation says (`open`
 * or `closed`; lists hold no expired ones), `created_by` is the inviting account.
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
        $user = $request->user();

        return [
            'id' => $invitation->id,
            'email' => $invitation->email,
            'org_role' => $invitation->org_role->value,
            'projects' => $invitation->projects,
            'link' => $user instanceof User && $user->tokenCan('write') ? InvitationLinks::for($invitation) : null,
            'state' => CheckInvitation::run($invitation)->value,
            'created_by' => $invitation->invited_by,
            'created_at' => $invitation->created_at?->toJSON(),
            'expires_at' => $invitation->expires_at->toJSON(),
        ];
    }
}
