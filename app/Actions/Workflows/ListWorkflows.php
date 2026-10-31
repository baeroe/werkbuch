<?php

namespace App\Actions\Workflows;

use App\Models\Workflow;
use App\Support\Actor;
use App\Support\ListResult;
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

    /**
     * @param  array<array-key, mixed>  $input  `cursor`, `per_page`
     * @return ListResult<Workflow>
     *
     * @throws ValidationException
     */
    public function handle(Actor $actor, array $input): ListResult
    {
        return ListResult::of(Workflow::query()->with(['states', 'transitions'])->orderBy('id'), PageArgs::from($input));
    }
}
