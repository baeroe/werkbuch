<?php

namespace App\Actions\Workflows;

use App\Models\Workflow;
use App\Support\Actor;
use App\Support\ListFilter;
use App\Support\ListQuery;
use App\Support\ListResult;
use App\Support\ListSpec;
use App\Support\PageArgs;
use Illuminate\Validation\ValidationException;
use Lorisleiva\Actions\Concerns\AsAction;

/**
 * The workflows of the organization with their states and transitions, by ULID (the order they were made in, the
 * shipped default first; a unique order for the cursor, P12). Every account reads them.
 */
final class ListWorkflows
{
    use AsAction;

    /** The rules of the list (A386, K7). */
    public static function spec(): ListSpec
    {
        return new ListSpec(
            filters: [
                ListFilter::partial('name', 'workflows.name'),
            ],
            sorts: ['name' => 'workflows.name', 'created_at' => 'workflows.id'],
            default: [],
        );
    }

    /**
     * @param  array<array-key, mixed>  $input  `filter`, `sort`, `cursor`, `per_page`
     * @return ListResult<Workflow>
     *
     * @throws ValidationException
     */
    public function handle(Actor $actor, array $input): ListResult
    {
        [$query, $signature] = ListQuery::apply(Workflow::query()->with(['states', 'transitions']), $input, self::spec());

        return ListResult::of($query, PageArgs::from($input), $signature);
    }
}
