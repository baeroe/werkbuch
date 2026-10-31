<?php

namespace App\Actions\Labels;

use App\Models\Label;
use App\Support\Actor;
use App\Support\ListResult;
use App\Support\PageArgs;
use Illuminate\Validation\ValidationException;
use Lorisleiva\Actions\Concerns\AsAction;

/**
 * The labels of the organization, by ULID (the order they were made in; a unique order for the cursor, P12). Every
 * account reads them.
 */
final class ListLabels
{
    use AsAction;

    /**
     * @param  array<array-key, mixed>  $input  `cursor`, `per_page`
     * @return ListResult<Label>
     *
     * @throws ValidationException
     */
    public function handle(Actor $actor, array $input): ListResult
    {
        return ListResult::of(Label::query()->orderBy('id'), PageArgs::from($input));
    }
}
