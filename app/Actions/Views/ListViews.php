<?php

namespace App\Actions\Views;

use App\Access\Authorize;
use App\Models\View;
use App\Support\Actor;
use App\Support\ListResult;
use App\Support\PageArgs;
use Illuminate\Validation\ValidationException;
use Lorisleiva\Actions\Concerns\AsAction;

/**
 * Every view of the team, by name and then ULID (a unique order for the cursor, P12). Every account reads them.
 */
final class ListViews
{
    use AsAction;

    /**
     * @param  array<array-key, mixed>  $input  `cursor`, `per_page`
     * @return ListResult<View>
     *
     * @throws ValidationException
     */
    public function handle(Actor $actor, array $input): ListResult
    {
        Authorize::check($actor, 'viewAny', View::class);

        return ListResult::of(View::query()->orderBy('name')->orderBy('id'), PageArgs::from($input));
    }
}
