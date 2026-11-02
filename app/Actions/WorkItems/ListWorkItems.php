<?php

namespace App\Actions\WorkItems;

use App\Exceptions\Problem;
use App\Models\WorkItem;
use App\Support\Actor;
use App\Support\ListResult;
use App\Views\ItemQueryInput;
use App\Views\Shorthand;
use Illuminate\Validation\ValidationException;
use Lorisleiva\Actions\Concerns\AsAction;

/**
 * The items of a query string (`GET /work-items`, P16), the same engine as QueryWorkItems
 * (ItemQueryInput::fromQuery):
 *
 * - `view`: the filter, the sort and the sub-items of a view (by ULID; unknown → 404); `filter[…]` narrows it, `sort`
 *   replaces its order.
 * - `filter[…]`: the short form (Shorthand::KEYS). `project` and `parent` as in Phase 4 (unknown or unseen → 404),
 *   `q` the key of a visible item or a part of the title; any other key is a 422 at `filter`.
 * - `sort`: `due_date`, `-due_date` (descending), `property:effort`; by default the manual order.
 * - `include_archived`, `lean` (no descriptions), `cursor`, `per_page`; `include` is a 422 (the list embeds nothing).
 */
final class ListWorkItems
{
    use AsAction;

    /** The filters of the query string: the short form. */
    public const FILTERS = Shorthand::KEYS;

    /**
     * @param  array<array-key, mixed>  $input  the query string
     * @return ListResult<WorkItem>
     *
     * @throws Problem 404 for an unknown view, or a project or parent the account does not see
     * @throws ValidationException
     */
    public function handle(Actor $actor, array $input): ListResult
    {
        return QueryWorkItems::page($actor, ItemQueryInput::fromQuery($input, $actor));
    }
}
