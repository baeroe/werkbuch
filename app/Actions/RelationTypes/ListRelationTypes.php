<?php

namespace App\Actions\RelationTypes;

use App\Models\RelationType;
use App\Support\Actor;
use App\Support\ListResult;
use App\Support\PageArgs;
use Illuminate\Validation\ValidationException;
use Lorisleiva\Actions\Concerns\AsAction;

/**
 * The relation types of the organization, by ULID (the order they were made in: the three built-in ones first; a unique
 * order for the cursor, P12). Every account reads them.
 */
final class ListRelationTypes
{
    use AsAction;

    /**
     * @param  array<array-key, mixed>  $input  `cursor`, `per_page`
     * @return ListResult<RelationType>
     *
     * @throws ValidationException
     */
    public function handle(Actor $actor, array $input): ListResult
    {
        return ListResult::of(RelationType::query()->orderBy('id'), PageArgs::from($input));
    }
}
