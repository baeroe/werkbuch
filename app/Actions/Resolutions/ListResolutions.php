<?php

namespace App\Actions\Resolutions;

use App\Models\Resolution;
use App\Support\Actor;
use App\Support\ListResult;
use App\Support\PageArgs;
use Illuminate\Validation\ValidationException;
use Lorisleiva\Actions\Concerns\AsAction;

/**
 * The resolutions of the organization by `position`, then by ULID (a unique order for the cursor, P12). Archived ones
 * belong to the list, items keep them. Every account reads them.
 */
final class ListResolutions
{
    use AsAction;

    /**
     * @param  array<array-key, mixed>  $input  `cursor`, `per_page`
     * @return ListResult<Resolution>
     *
     * @throws ValidationException
     */
    public function handle(Actor $actor, array $input): ListResult
    {
        return ListResult::of(Resolution::query()->orderBy('position')->orderBy('id'), PageArgs::from($input));
    }
}
