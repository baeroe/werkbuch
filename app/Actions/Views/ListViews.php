<?php

namespace App\Actions\Views;

use App\Access\Authorize;
use App\Models\View;
use App\Support\Actor;
use App\Support\ListFilter;
use App\Support\ListQuery;
use App\Support\ListResult;
use App\Support\ListSpec;
use App\Support\PageArgs;
use Illuminate\Validation\ValidationException;
use Lorisleiva\Actions\Concerns\AsAction;

/**
 * Every view of the team, by name and then ULID (a unique order for the cursor, P12). Every account reads them.
 */
final class ListViews
{
    use AsAction;

    /** The rules of the list (A386, K7). */
    public static function spec(): ListSpec
    {
        return new ListSpec(
            filters: [
                ListFilter::ulid('created_by', 'views.created_by'),
                ListFilter::partial('name', 'views.name'),
            ],
            sorts: ['name' => 'views.name', 'created_at' => 'views.id'],
            default: ['name'],
        );
    }

    /**
     * @param  array<array-key, mixed>  $input  `filter`, `sort`, `cursor`, `per_page`
     * @return ListResult<View>
     *
     * @throws ValidationException
     */
    public function handle(Actor $actor, array $input): ListResult
    {
        Authorize::check($actor, 'viewAny', View::class);

        [$query, $signature] = ListQuery::apply(View::query(), $input, self::spec());

        return ListResult::of($query, PageArgs::from($input), $signature);
    }
}
