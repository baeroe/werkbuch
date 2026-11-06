<?php

namespace App\Support;

use Closure;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Http\Request;
use Illuminate\Support\Str;
use Illuminate\Validation\ValidationException;
use Spatie\QueryBuilder\AllowedFilter;
use Spatie\QueryBuilder\AllowedSort;
use Spatie\QueryBuilder\QueryBuilder;

/**
 * The query of a list by its `ListSpec` (A386): `filter[<name>]`, `sort` (names separated by commas, `-` descending)
 * and `include` (relations separated by commas), built by the query builder (spatie/laravel-query-builder).
 *
 * - The query is checked against the spec first, every error in one 422 (K11): unknown names at `filter`, `sort` and
 *   `include` (each with the names it takes), a value a filter does not take at `filter.<name>`; an empty value is
 *   no condition. The query builder
 *   only builds what passed, so its own exceptions (one per call, 400) never come.
 * - The spec is the whole order: an order the query brings goes, the sorts follow (a name given twice counts where it
 *   first stands), then the ULID, so the order is unique. The signature of that order (`name:asc,id:asc`) is selected
 *   as the literal `_sig`, so the cursor of a page carries it and `ListResult` refuses a cursor of another sort (K12).
 * - A fixed list (`ListSpec::fixed()`) takes no filter, sort or include; its query, its order and its cursor stay as
 *   the action made them, the signature is `''`.
 */
final class ListQuery
{
    /** The values of Laravel's `boolean`. */
    private const BOOLEANS = [true, false, 0, 1, '0', '1'];

    /**
     * @template TModel of Model
     *
     * @param  Builder<TModel>  $query  the rows the action reads anyway (visibility first)
     * @param  array<array-key, mixed>  $input  the query of the request
     * @return array{0: Builder<TModel>, 1: string} the query and the signature of its order
     *
     * @throws ValidationException at `filter`, `filter.<name>`, `sort` or `include`
     */
    public static function apply(Builder $query, array $input, ListSpec $spec): array
    {
        $errors = [];
        $filters = self::filters($input['filter'] ?? null, $spec, $errors);
        $sorts = self::names($input, 'sort', $spec->sortable ? array_keys($spec->sorts) : [], fn (string $sort) => ltrim($sort, '-'), $errors);
        $includes = self::names($input, 'include', $spec->includes, fn (string $include) => $include, $errors);
        if ($errors !== []) {
            throw ValidationException::withMessages($errors);
        }

        if ($spec->fixed) {
            return [$query, ''];
        }

        // a name given twice counts where it first stands
        $sorts = array_values(array_reduce($sorts, fn (array $kept, string $sort) => $kept + [ltrim($sort, '-') => $sort], []));
        $request = Request::create('/', 'GET', [
            // the query builder reads 'true' and 'false' as booleans: it only learns that the filter is there, every
            // filter applies the text it read itself (T4-I1)
            'filter' => array_map(fn (mixed $value) => 1, $filters),
            'sort' => implode(',', $sorts),
            'include' => implode(',', $includes),
        ]);

        $query->reorder();
        $sort = fn (string $name) => AllowedSort::field($name, $spec->sorts[ltrim($name, '-')]);
        QueryBuilder::for($query, $request)
            ->allowedFilters(...array_map(fn (ListFilter $filter) => self::allowed($filter, $filters), array_values($spec->filters)))
            ->defaultSort(...array_map($sort, $spec->default))
            ->allowedSorts(...array_map($sort, array_keys($spec->sorts)))
            ->allowedIncludes(...$spec->includes);
        $query->orderBy($query->qualifyColumn($query->getModel()->getKeyName()), $spec->tiebreak);

        $signature = implode(',', [
            ...array_map(fn (string $sort) => ltrim($sort, '-').':'.(str_starts_with($sort, '-') ? 'desc' : 'asc'), $sorts === [] ? $spec->default : $sorts),
            'id:'.$spec->tiebreak,
        ]);
        if ($query->getQuery()->columns === null) {
            $query->select($query->qualifyColumn('*'));
        }
        $query->selectRaw('? as '.SignedCursor::KEY, [$signature]);

        return [$query, $signature];
    }

    /**
     * The filters of the query, checked against the spec, with their values in the form the filter applies them.
     *
     * @param  array<string, list<mixed>>  $errors
     * @return array<string, mixed>
     */
    private static function filters(mixed $given, ListSpec $spec, array &$errors): array
    {
        if ($given === null || $given === '' || $given === []) {
            return [];
        }
        if (! is_array($given)) {
            $errors['filter'] = [__('field.list.filter_object')];

            return [];
        }

        $filters = [];
        foreach ($given as $name => $value) {
            $filter = $spec->filters[(string) $name] ?? null;
            if ($filter === null) {
                $errors['filter'][] = __('field.list.filter', ['name' => $name, 'allowed' => self::allowedNames(array_keys($spec->filters))]);

                continue;
            }

            // an empty value is no condition (`filter[name]=`, as in the shorthand of the item lists)
            if ($value === null || $value === '') {
                continue;
            }
            $read = self::value($filter, $value);
            if ($read === null) {
                $errors['filter.'.$name] = [self::valueError($filter)];

                continue;
            }
            $filters[$filter->name] = $read[0];
        }

        return $filters;
    }

    /**
     * The value of a filter in the form it applies it, or `null` when the filter does not take it.
     *
     * @return array{0: mixed}|null
     */
    private static function value(ListFilter $filter, mixed $value): ?array
    {
        if ($filter->type === 'boolean') {
            return in_array($value, self::BOOLEANS, true) ? [(bool) $value] : null;
        }
        if (! is_string($value) && ! is_int($value)) {
            return null;
        }

        $value = (string) $value;
        if ($filter->values !== null && array_diff(explode(',', $value), $filter->values) !== []) {
            return null;
        }

        return [$filter->kind === ListFilter::SCOPE && $filter->type === 'list<string>' ? explode(',', $value) : $value];
    }

    private static function valueError(ListFilter $filter): string
    {
        $allowed = $filter->type === 'boolean' ? '1, 0' : implode(', ', $filter->values ?? []);

        return $allowed === ''
            ? __('field.list.filter_text', ['name' => $filter->name])
            : __('field.list.filter_value', ['name' => $filter->name, 'allowed' => $allowed]);
    }

    /**
     * The names of `sort` or `include`, separated by commas, each one a name the spec takes.
     *
     * @param  array<array-key, mixed>  $input
     * @param  list<string>  $allowed
     * @param  callable(string): string  $nameOf
     * @param  array<string, list<mixed>>  $errors
     * @return list<string>
     */
    private static function names(array $input, string $key, array $allowed, callable $nameOf, array &$errors): array
    {
        $given = $input[$key] ?? null;
        if ($given === null || $given === '') {
            return [];
        }
        if (! is_string($given)) {
            $errors[$key] = [__('field.list.names')];

            return [];
        }

        $names = array_values(array_filter(explode(',', $given), fn (string $name) => $name !== ''));
        foreach ($names as $name) {
            if (! in_array($nameOf($name), $allowed, true)) {
                $errors[$key][] = __('field.list.'.$key, ['name' => $nameOf($name), 'allowed' => self::allowedNames($allowed)]);
            }
        }

        return $names;
    }

    /**
     * @param  list<string>  $names
     */
    private static function allowedNames(array $names): string
    {
        return $names === [] ? __('field.list.none') : implode(', ', $names);
    }

    /**
     * The filter for the query builder; booleans and scopes apply the value read above, not the builder's own.
     *
     * @param  array<string, mixed>  $values
     */
    private static function allowed(ListFilter $filter, array $values): AllowedFilter
    {
        return match ($filter->kind) {
            ListFilter::EXACT => AllowedFilter::callback($filter->name, function (Builder $query) use ($filter, $values) {
                $column = $query->qualifyColumn($filter->column);
                $wanted = explode(',', (string) $values[$filter->name]);
                // a column of ids takes real ULIDs only: the collation would let look-alikes through (A96)
                if ($filter->column === 'id' || str_ends_with($filter->column, '_id') || str_ends_with($filter->column, '.id')) {
                    $wanted = array_map(fn (string $id) => Ids::normalize($id), $wanted);
                    $wanted = array_values(array_filter($wanted, fn ($id) => Str::isUlid($id)));
                }
                $wanted === [] ? $query->whereRaw('0 = 1') : $query->whereIn($column, $wanted);
            }),
            // a comma is part of the text (K11); `\`, `%` and `_` are masked
            ListFilter::PARTIAL => AllowedFilter::callback($filter->name, fn (Builder $query) => $query->where(
                $query->qualifyColumn($filter->column),
                'like',
                '%'.addcslashes((string) $values[$filter->name], '\\%_').'%',
            )),
            ListFilter::BOOLEAN => AllowedFilter::callback($filter->name, fn (Builder $query) => $query->where($query->qualifyColumn($filter->column), $values[$filter->name])),
            default => AllowedFilter::callback($filter->name, function (Builder $query) use ($filter, $values) {
                /** @var Closure(Builder<*>, mixed): mixed $apply a scope always has its rule */
                $apply = $filter->apply;
                $apply($query, $values[$filter->name]);
            }),
        };
    }
}
