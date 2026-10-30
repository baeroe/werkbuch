<?php

namespace App\Actions\Auth;

use App\Access\Permission;
use App\Access\Visibility;
use App\Enums\InvitationState;
use App\Models\Invitation;
use App\Models\User;
use Lorisleiva\Actions\Concerns\AsAction;

/**
 * Whether an invitation can still be accepted (P7). It is closed when there is none (unknown or replaced by a newer
 * one), when it was accepted, when the inviter is no longer an active org admin (an admin who lost the role or was
 * deactivated takes the invitations with them) or when an account with the address exists; the visitor learns no
 * reason. Only then a lapsed one is `expired`.
 */
final class CheckInvitation
{
    use AsAction;

    public function handle(?Invitation $invitation): InvitationState
    {
        if ($invitation === null || $invitation->accepted_at !== null) {
            return InvitationState::Closed;
        }

        $inviter = $invitation->inviter;

        if ($inviter === null || ! Visibility::can($inviter, Permission::OrgManage) || User::query()->where('email', $invitation->email)->exists()) {
            return InvitationState::Closed;
        }

        return $invitation->expires_at->isPast() ? InvitationState::Expired : InvitationState::Open;
    }
}
