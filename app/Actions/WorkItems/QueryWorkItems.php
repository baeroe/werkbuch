<?php

namespace App\Actions\WorkItems;

use App\Exceptions\Problem;
use App\Models\WorkItem;
use App\Support\Actor;
use App\Support\ListResult;
use App\Views\ItemOrder;
use App\Views\ItemQuery;
use App\Views\ItemQueryInput;
use Illuminate\Database\Eloquent\Collection as EloquentCollection;
use Illuminate\Validation\ValidationException;
use Lorisleiva\Actions\Concerns\AsAction;

/**
 * One page of the items a query body asks for (`POST /work-items/query`, a read, P15): a view, a filter in the long
 * and the short form, a search, a sort, sub-items or not, archived or not, lean or full, the items of one group
 * (`group_by` and `group`; ItemQueryInput::fromBody).
 * Only items the account sees (ItemQuery), in the order that holds (ItemOrder, a keyset cursor), with the number of all
 * matches; every item of the page is loaded for WorkItemResource with the account as reader (K5).
 */
final class QueryWorkItems
{
    use AsAction;

    /**
     * @param  array<array-key, mixed>  $input  the body (ItemQueryInput::BODY_KEYS)
     * @return ListResult<WorkItem>
     *
     * @throws Problem 404 for an unknown view, or a short-form project or parent the account does not see
     * @throws ValidationException
     */
    public function handle(Actor $actor, array $input): ListResult
    {
        return self::page($actor, ItemQueryInput::fromBody($input, $actor));
    }

    /**
     * The page of a read request, for this action and ListWorkItems.
     *
     * @return ListResult<WorkItem>
     *
     * @throws ValidationException at `cursor`
     */
    public static function page(Actor $actor, ItemQueryInput $input): ListResult
    {
        $query = ItemQuery::for($actor, $input);
        $total = (clone $query)->toBase()->getCountForPagination();
        // the cursor of a group's page belongs to that group (K5)
        $group = $input->group === null ? null : $input->groupBy?->value.':'.$input->group;
        $page = ItemOrder::page($query, ItemQuery::sortOf($input), $input->page, $group);
        WorkItem::loadForResource(new EloquentCollection($page->items()), $actor->user, $input->lean);

        return new ListResult($page, $total);
    }
}
