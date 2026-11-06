<?php

namespace App\Actions\Labels;

use App\Models\Label;
use App\Support\Actor;
use App\Support\ListFilter;
use App\Support\ListQuery;
use App\Support\ListResult;
use App\Support\ListSpec;
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

    /** The rules of the list (A386, K7). */
    public static function spec(): ListSpec
    {
        return new ListSpec(
            filters: [
                ListFilter::partial('name', 'labels.name'),
            ],
            sorts: ['name' => 'labels.name', 'created_at' => 'labels.id'],
            default: [],
        );
    }

    /**
     * @param  array<array-key, mixed>  $input  `filter`, `sort`, `cursor`, `per_page`
     * @return ListResult<Label>
     *
     * @throws ValidationException
     */
    public function handle(Actor $actor, array $input): ListResult
    {
        [$query, $signature] = ListQuery::apply(Label::query(), $input, self::spec());

        return ListResult::of($query, PageArgs::from($input), $signature);
    }
}
