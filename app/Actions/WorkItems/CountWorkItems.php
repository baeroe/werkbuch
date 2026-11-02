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

/**
 * The number of items of named filters in one call (`POST /work-items/counts`, a read, P15, P18): `filters` is an
 * object of 1–MAX_FILTERS filters by name (NAME_PATTERN), each read by FilterSchema::parse (errors below
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
     * The filters by name; an object of 1–MAX_FILTERS entries (a list is no object), every name of NAME_PATTERN.
     *
     * @param  array<array-key, mixed>  $errors
     * @return array<string, Filter>
     */
    private static function filters(mixed $filters, array &$errors): array
    {
        if (! is_array($filters) || $filters === [] || array_is_list($filters) || count($filters) > self::MAX_FILTERS) {
            $errors['filters'] = __('field.filters.invalid', ['max' => self::MAX_FILTERS]);

            return [];
        }

        $parsed = [];
        foreach ($filters as $name => $filter) {
            $name = (string) $name;
            if (preg_match(self::NAME_PATTERN, $name) !== 1) {
                $errors['filters'] = __('field.filters.name', ['name' => $name]);

                continue;
            }
            try {
                $parsed[$name] = FilterSchema::parse($filter, app(CatalogProperties::class));
            } catch (InvalidInput $invalid) {
                $errors = [...$errors, ...SchemaMessages::filter($invalid, 'filters.'.$name)];
            }
        }

        return $parsed;
    }
}
