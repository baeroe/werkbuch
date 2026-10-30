<?php

namespace App\Actions\Tokens;

use App\Access\Authorize;
use App\Models\PersonalAccessToken;
use App\Models\User;
use App\Support\Actor;
use App\Support\ListResult;
use App\Support\PageArgs;
use Illuminate\Validation\ValidationException;
use Lorisleiva\Actions\Concerns\AsAction;

/**
 * The tokens of an account (the own ones, or a bot's for an org admin), the oldest first; never their plain text.
 */
final class ListTokens
{
    use AsAction;

    /**
     * @param  array<array-key, mixed>  $input  `cursor`, `per_page`
     * @return ListResult<PersonalAccessToken>
     *
     * @throws ValidationException
     */
    public function handle(Actor $actor, User $owner, array $input): ListResult
    {
        Authorize::check($actor, 'manageTokens', $owner);

        return ListResult::of(PersonalAccessToken::query()->whereMorphedTo('tokenable', $owner)->orderBy('id'), PageArgs::from($input));
    }
}
