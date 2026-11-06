<?php

namespace App\Actions\WorkItems;

use App\Domain\Filter\Filter;
use App\Domain\Filter\FilterSchema;
use App\Domain\Filter\InvalidInput;
use App\Support\Actor;
use App\Support\SchemaMessages;
use App\Views\CatalogProperties;
use App\Views\ItemQuery;
use App\Views\ItemQueryInput;
use Illuminate\Validation\ValidationException;
use Lorisleiva\Actions\Concerns\AsAction;
use stdClass;

/**
 * The number of items of named filters in one call (`POST /work-items/counts`, a read, P15, P18): `filters` is an
 * object of 1–MAX_FILTERS filters by name (NAME_PATTERN, `0` too), each read by FilterSchema::parse (errors below
 * `filters.<name>.`), and `include_archived` holds for all. Every number comes from ItemQuery, so it only counts items
 * the account sees: a filter on a hidden project counts 0, never 404.
 */
final class CountWorkItems
{
    use AsAction;

    /** The keys of the body. */
    public const KEYS = ['filters', 'include_archived'];

    public const MAX_FILTERS = 50;

    public const NAME_PATTERN = '/^[a-z0-9_.:-]{1,64}\z/i';

    /**
     * @param  array<array-key, mixed>  $input  the body (KEYS)
     * @return array<string, int> name → number of items
     *
     * @throws ValidationException
     */
    public function handle(Actor $actor, array $input): array
    {
        $errors = [];
        foreach (array_diff(array_map('strval', array_keys($input)), self::KEYS) as $unknown) {
            $errors[$unknown] = __('field.query.unknown', ['keys' => implode(', ', self::KEYS)]);
        }
        $flags = ItemQueryInput::flags(array_filter($input, fn (mixed $value) => $value !== null), ['include_archived'], $errors);
        $filters = self::filters($input['filters'] ?? null, $errors);
        if ($errors !== []) {
            throw ValidationException::withMessages($errors);
        }

        return array_map(
            fn (Filter $filter): int => ItemQuery::for($actor, ItemQueryInput::ofFilter($filter, $flags['include_archived'] ?? false))
                ->toBase()->getCountForPagination(),
            $filters,
        );
    }

    /**
     * The filters by name; an object of 1–MAX_FILTERS entries, every name of NAME_PATTERN. An object of JSON comes as
     * `stdClass` (the controller keeps it one), so `{"0": …}` is an object; an array is one only when it is no list
     * (`[f]` names no filter). Every wrong name is named.
     *
     * @param  array<array-key, mixed>  $errors
     * @return array<string, Filter>
     */
    private static function filters(mixed $filters, array &$errors): array
    {
        $filters = $filters instanceof stdClass ? get_object_vars($filters) : (is_array($filters) && array_is_list($filters) ? null : $filters);

        if (! is_array($filters) || $filters === [] || count($filters) > self::MAX_FILTERS) {
            $errors['filters'] = __('field.filters.invalid', ['max' => self::MAX_FILTERS]);

            return [];
        }

        $parsed = [];
        $wrong = [];
        foreach ($filters as $name => $filter) {
            $name = (string) $name;
            if (preg_match(self::NAME_PATTERN, $name) !== 1) {
                $wrong[] = $name;

                continue;
            }
            try {
                $parsed[$name] = FilterSchema::parse($filter, app(CatalogProperties::class));
            } catch (InvalidInput $invalid) {
                $errors = [...$errors, ...SchemaMessages::filter($invalid, 'filters.'.$name)];
            }
        }

        if ($wrong !== []) {
            $errors['filters'] = count($wrong) === 1
                ? __('field.filters.name', ['name' => $wrong[0]])
                : __('field.filters.names', ['names' => implode(', ', $wrong)]);
        }

        return $parsed;
    }
}
