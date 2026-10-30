<?php

namespace App\Enums;

/**
 * What a visitor of an invitation link may do: accept (`open`), only see that it ran out (`expired`) or that it no longer
 * works for any other reason (`closed`: accepted, replaced, inviter gone, address already has an account, unknown).
 */
enum InvitationState: string
{
    case Open = 'open';
    case Expired = 'expired';
    case Closed = 'closed';
}
