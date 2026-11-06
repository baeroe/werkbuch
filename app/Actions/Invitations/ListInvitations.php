<?php

namespace App\Actions\Invitations;

use App\Access\Authorize;
use App\Access\OrgRole;
use App\Models\Invitation;
use App\Models\User;
use App\Support\Actor;
use App\Support\ListFilter;
use App\Support\ListQuery;
use App\Support\ListResult;
use App\Support\ListSpec;
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

    /** The rules of the list (A386, K7: the oldest first stays the default; `created_at` is the ULID). */
    public static function spec(): ListSpec
    {
        return new ListSpec(
            filters: [ListFilter::exact('org_role', 'invitations.org_role', array_column(OrgRole::cases(), 'value'))],
            sorts: ['expires_at' => 'invitations.expires_at', 'created_at' => 'invitations.id'],
        );
    }

    /**
     * @param  array<array-key, mixed>  $input  `filter`, `sort`, `cursor`, `per_page`
     * @return ListResult<Invitation>
     *
     * @throws ValidationException
     */
    public function handle(Actor $actor, array $input): ListResult
    {
        Authorize::check($actor, 'viewInvitations', User::class);

        [$query, $signature] = ListQuery::apply(Invitation::query()->open()->with('inviter'), $input, self::spec());

        return ListResult::of($query, PageArgs::from($input), $signature);
    }
}
