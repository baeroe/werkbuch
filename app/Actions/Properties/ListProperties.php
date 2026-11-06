<?php

namespace App\Actions\Properties;

use App\Domain\Properties\FieldType;
use App\Models\Property;
use App\Support\Actor;
use App\Support\ListFilter;
use App\Support\ListQuery;
use App\Support\ListResult;
use App\Support\ListSpec;
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

    /** The rules of the list (A386, K7). */
    public static function spec(): ListSpec
    {
        return new ListSpec(
            filters: [
                ListFilter::partial('label', 'properties.label'),
                ListFilter::exact('field_type', 'properties.field_type', array_column(FieldType::cases(), 'value')),
            ],
            sorts: ['label' => 'properties.label', 'key' => 'properties.key', 'created_at' => 'properties.id'],
            default: [],
        );
    }

    /**
     * @param  array<array-key, mixed>  $input  `filter`, `sort`, `cursor`, `per_page`
     * @return ListResult<Property>
     *
     * @throws ValidationException
     */
    public function handle(Actor $actor, array $input): ListResult
    {
        [$query, $signature] = ListQuery::apply(Property::query()->with('options'), $input, self::spec());

        return ListResult::of($query, PageArgs::from($input), $signature);
    }
}
