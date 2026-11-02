<?php

namespace App\Actions\WorkItems;

use App\Domain\Views\GroupBy;
use App\Exceptions\Problem;
use App\Support\Actor;
use App\Views\Grouping;
use App\Views\ItemGroups;
use App\Views\ItemQuery;
use App\Views\ItemQueryInput;
use Illuminate\Validation\ValidationException;
use Lorisleiva\Actions\Concerns\AsAction;

/**
 * The groups of a query and their numbers (`POST /work-items/groups`, a read, P15): the body of `POST /work-items/query`
 * without the short form (K8: the browser always sends conditions, so a group never answers 404 for a project),
 * `group`, the page and `lean`; `group_by` is required. Only items the account sees count (ItemQuery); the answer names
 * the grouping that holds (`state` becomes `category` over several workflows, P14), which the pages of the groups then
 * ask with (K17).
 */
final class GroupWorkItems
{
    use AsAction;

    /** The keys of the body. */
    public const KEYS = ['view_id', 'filter', 'q', 'sort', 'show_sub_items', 'group_by', 'include_archived'];

    /**
     * @param  array<array-key, mixed>  $input  the body (KEYS)
     *
     * @throws Problem 404 for an unknown view
     * @throws ValidationException
     */
    public function handle(Actor $actor, array $input): ItemGroups
    {
        $input = ItemQueryInput::fromBody($input, $actor, self::KEYS, true);
        $query = ItemQuery::for($actor, $input);
        $by = Grouping::effective($query, $input->groupBy ?? GroupBy::None);

        return new ItemGroups(
            $by,
            (clone $query)->toBase()->getCountForPagination(),
            Grouping::counts($query, $by, ItemQuery::filterOf($input), $actor->user),
        );
    }
}
