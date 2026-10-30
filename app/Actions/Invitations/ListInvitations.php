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
 * The open invitations (org admins): not accepted and not run out. Ordered by ULID, so the oldest comes first.
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

        return ListResult::of(Invitation::query()->open()->orderBy('id'), PageArgs::from($input));
    }
}
