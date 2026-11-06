<?php

namespace App\Actions\Tokens;

use App\Access\Authorize;
use App\Exceptions\Problem;
use App\Models\PersonalAccessToken;
use App\Support\Actor;
use App\Support\ListFilter;
use App\Support\ListQuery;
use App\Support\ListResult;
use App\Support\ListSpec;
use App\Support\PageArgs;
use App\Support\TokenOwner;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Validation\ValidationException;
use Lorisleiva\Actions\Concerns\AsAction;

/**
 * The tokens of an account (the own ones, or a bot's for an org admin; `filter[user_id]` names it), the oldest first;
 * never their plain text.
 */
final class ListTokens
{
    use AsAction;

    /** The rules of the list (A386, K7: the oldest first stays the default; `created_at` is the ULID). The owner is read by the action. */
    public static function spec(): ListSpec
    {
        return new ListSpec(
            filters: [ListFilter::scope('user_id', 'string', fn (Builder $query, mixed $id) => $query)],
            sorts: ['name' => 'personal_access_tokens.name', 'created_at' => 'personal_access_tokens.id'],
        );
    }

    /**
     * @param  array<array-key, mixed>  $input  `filter[user_id]` (the owner; without it the own account), `sort`, `cursor`, `per_page`
     * @return ListResult<PersonalAccessToken>
     *
     * @throws Problem 404 for an owner that is no ULID or unknown
     * @throws ValidationException
     */
    public function handle(Actor $actor, array $input): ListResult
    {
        $filter = $input['filter'] ?? null;
        $owner = TokenOwner::of(is_array($filter) ? ($filter['user_id'] ?? null) : null, $actor);
        Authorize::check($actor, 'manageTokens', $owner);

        [$query, $signature] = ListQuery::apply(PersonalAccessToken::query()->whereMorphedTo('tokenable', $owner), $input, self::spec());

        return ListResult::of($query, PageArgs::from($input), $signature);
    }
}
