<?php

namespace App\Actions\RelationTypes;

use App\Models\RelationType;
use App\Support\Actor;
use App\Support\ListFilter;
use App\Support\ListQuery;
use App\Support\ListResult;
use App\Support\ListSpec;
use App\Support\PageArgs;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Validation\ValidationException;
use Lorisleiva\Actions\Concerns\AsAction;

/**
 * The relation types of the organization, by ULID (the order they were made in: the three built-in ones first; a unique
 * order for the cursor, P12). Every account reads them.
 */
final class ListRelationTypes
{
    use AsAction;

    /** The rules of the list (A386, K7). */
    public static function spec(): ListSpec
    {
        return new ListSpec(
            filters: [
                ListFilter::partial('name', 'relation_types.name'),
                ListFilter::scope('built_in', 'boolean', fn (Builder $query, mixed $builtIn) => $builtIn ? $query->whereNotNull('relation_types.built_in') : $query->whereNull('relation_types.built_in')),
            ],
            sorts: ['name' => 'relation_types.name', 'created_at' => 'relation_types.id'],
            default: [],
        );
    }

    /**
     * @param  array<array-key, mixed>  $input  `filter`, `sort`, `cursor`, `per_page`
     * @return ListResult<RelationType>
     *
     * @throws ValidationException
     */
    public function handle(Actor $actor, array $input): ListResult
    {
        [$query, $signature] = ListQuery::apply(RelationType::query(), $input, self::spec());

        return ListResult::of($query, PageArgs::from($input), $signature);
    }
}
