<?php

namespace App\Actions\Properties;

use App\Models\Property;
use App\Support\Actor;
use App\Support\ListResult;
use App\Support\PageArgs;
use Illuminate\Validation\ValidationException;
use Lorisleiva\Actions\Concerns\AsAction;

/**
 * The properties of the organization with their options in order, by ULID (the order they were made in; a unique order
 * for the cursor, P12). Every account reads them.
 */
final class ListProperties
{
    use AsAction;

    /**
     * @param  array<array-key, mixed>  $input  `cursor`, `per_page`
     * @return ListResult<Property>
     *
     * @throws ValidationException
     */
    public function handle(Actor $actor, array $input): ListResult
    {
        return ListResult::of(Property::query()->with('options')->orderBy('id'), PageArgs::from($input));
    }
}
