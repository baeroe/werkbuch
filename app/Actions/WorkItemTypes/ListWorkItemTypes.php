<?php

namespace App\Actions\WorkItemTypes;

use App\Models\WorkItemType;
use App\Support\Actor;
use App\Support\ListResult;
use App\Support\PageArgs;
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

    /**
     * @param  array<array-key, mixed>  $input  `cursor`, `per_page`
     * @return ListResult<WorkItemType>
     *
     * @throws ValidationException
     */
    public function handle(Actor $actor, array $input): ListResult
    {
        return ListResult::of(WorkItemType::query()->with('typeProperties')->orderBy('id'), PageArgs::from($input));
    }
}
