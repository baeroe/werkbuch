<?php

namespace App\Actions\Invitations;

use App\Access\Authorize;
use App\Models\Invitation;
use App\Models\User;
use App\Support\Actor;
use App\Support\ListResult;
use App\Support\PageArgs;
use Illuminate\Validation\ValidationException;
use Lorisleiva\Actions\Concerns\AsAction;

/**
 * The invitations nobody accepted and that have not run out (org admins), the oldest first (ULID). One whose link no
 * longer works for another reason (inviter demoted or deactivated, an account with the address) stays in the list; the
 * resource names it `closed` (CheckInvitation), so the screens can show it as such.
 */
final class ListInvitations
{
    use AsAction;

    /**
     * @param  array<array-key, mixed>  $input  `cursor`, `per_page`
     * @return ListResult<Invitation>
     *
     * @throws ValidationException
     */
    public function handle(Actor $actor, array $input): ListResult
    {
        Authorize::check($actor, 'viewInvitations', User::class);

        return ListResult::of(Invitation::query()->open()->with('inviter')->orderBy('id'), PageArgs::from($input));
    }
}
