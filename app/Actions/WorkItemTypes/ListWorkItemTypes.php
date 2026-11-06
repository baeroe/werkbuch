<?php

namespace App\Actions\WorkItemTypes;

use App\Models\WorkItemType;
use App\Support\Actor;
use App\Support\ListFilter;
use App\Support\ListQuery;
use App\Support\ListResult;
use App\Support\ListSpec;
use App\Support\PageArgs;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Validation\ValidationException;
use Lorisleiva\Actions\Concerns\AsAction;

/**
 * The work item types of the organization with their properties in order, by ULID (the order they were made in: the
 * shipped Task, Bug and Epic first; a unique order for the cursor, P12). Archived types belong to the list, items keep
 * them. Every account reads them.
 */
final class ListWorkItemTypes
{
    use AsAction;

    /** The rules of the list (A386, K7). */
    public static function spec(): ListSpec
    {
        return new ListSpec(
            filters: [
                ListFilter::partial('name', 'work_item_types.name'),
                ListFilter::boolean('is_epic', 'work_item_types.is_epic'),
                ListFilter::scope('archived', 'boolean', fn (Builder $query, mixed $archived) => $archived ? $query->whereNotNull('work_item_types.archived_at') : $query->whereNull('work_item_types.archived_at')),
            ],
            sorts: ['name' => 'work_item_types.name', 'created_at' => 'work_item_types.id'],
            default: [],
        );
    }

    /**
     * @param  array<array-key, mixed>  $input  `filter`, `sort`, `cursor`, `per_page`
     * @return ListResult<WorkItemType>
     *
     * @throws ValidationException
     */
    public function handle(Actor $actor, array $input): ListResult
    {
        [$query, $signature] = ListQuery::apply(WorkItemType::query()->with('typeProperties'), $input, self::spec());

        return ListResult::of($query, PageArgs::from($input), $signature);
    }
}
