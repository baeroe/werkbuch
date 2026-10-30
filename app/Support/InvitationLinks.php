<?php

namespace App\Support;

use App\Models\Invitation;
use Illuminate\Support\Facades\URL;

/**
 * The link of an invitation (P7): the relative signed URL of the page with the ULID of the invitation, behind APP_URL,
 * never behind the host of a request. The signature only proves the link was issued here; the invitation row decides
 * whether it still works (App\Actions\Auth\CheckInvitation).
 */
final class InvitationLinks
{
    public static function for(Invitation $invitation): string
    {
        return rtrim((string) config('app.url'), '/').URL::signedRoute('invitations.show', ['invitation' => $invitation->id], absolute: false);
    }
}
