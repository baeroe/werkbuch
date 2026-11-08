<?php

namespace App\Views;

use App\Domain\Filter\Field;
use App\Domain\Properties\FieldType;
use App\Domain\Views\SortSpec;
use App\Domain\Workflow\StateCategory;
use App\Domain\WorkItems\Priority;
use App\Models\WorkItem;
use App\Support\PageArgs;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Database\Query\Expression;
use Illuminate\Database\Query\JoinClause;
use Illuminate\Pagination\Cursor;
use Illuminate\Pagination\CursorPaginator;
use Illuminate\Pagination\Paginator;
use Illuminate\Validation\ValidationException;

/**
 * The order of an item list and its pages (plan, table "Sortierung"; P11, P12): what `sortItems` of the clickdummy
 * does for the loaded items, done by the database, with a keyset cursor of its own.
 *
 * - Every sort is a list of keys, selected as `sort_0` … `sort_n`, and then `rank` ascending (byte by byte, the
 *   column is `ascii_bin`) and the ULID, so the order is unique and a cursor never loses or repeats an item. The
 *   direction turns only the value itself: the mark of an empty value (`… is null`, 0 before 1) keeps empty values
 *   last in both directions, and the guard of `coalesce` makes every value comparable; `rank` and the ULID always
 *   ascend (the manual sort turns its rank).
 * - Texts sort naturally (A450, changes A168): a text or address property and the identifier of a key by
 *   `natural_sort_key()` under the collation of the column, so "Item 9" comes before "Item 10" and `A2` before `A10`,
 *   as `sort.ts` orders them with `Intl.Collator(…, {numeric: true})`. The cursor carries that key, and the signature
 *   of a natural order ends on `~natural`: a cursor of the collation order before it is refused, not misread.
 * - The key of an item is the identifier of its project (naturally) and its number; the category is that of its
 *   state. Both come from joins with their own aliases (`sort_projects`, `sort_states`, K3), so no condition of
 *   `FilterQuery` meets a column of another table. A property sorts by its first value (`position` 0), joined once as
 *   `sort_values`; an item whose type does not have the property (any more) counts as empty, like one without a value.
 * - The next page is the keyset condition `(k0 > v0) or (k0 = v0 and k1 > v1) or …` (`<` for a descending key),
 *   written out, since Laravel's `cursorPaginate` knows neither marks nor expressions nor mixed directions. The
 *   previous page asks with every direction turned; the paginator turns its rows back (K5).
 * - The cursor carries the values of the last (or first) row and `_sig`: the signature of the sort and, for the page
 *   of one group, `group_by:group`, selected as a literal, so the paginator reads it off the row. A cursor that does
 *   not read, names other keys or another signature, or carries a value of the wrong form is 422 at `cursor`.
 */
final class ItemOrder
{
    private const CURSOR_SIGNATURE = '_sig';

    /** The end of the signature of an order with a natural key: a cursor of the order by collation (A168) lacks it. */
    private const NATURAL_SIGNATURE = '~natural';

    /** The sorts of a property, with the column of its value and the guard of `coalesce`. */
    private const PROPERTY_VALUES = [
        FieldType::Number->value => ['value_number', '0', 'decimal'],
        FieldType::Date->value => ['value_date', "date '0001-01-01'", 'day'],
        FieldType::Text->value => ['value_string', "''", 'natural'],
        FieldType::Url->value => ['value_string', "''", 'natural'],
    ];

    /**
     * One page of the query in the order of the sort; the query (filtered) changes with it, an order it brings goes.
     *
     * The rows carry the keys of the order (`sort_0`, `sort_1`, …) and the signature (`_sig`) as attributes, because the
     * cursor reads them from there: they are the business of the paginator, never of the caller. A row of a page is for
     * reading; it is never given to `save()` or `toArray()` for a write (they are original attributes, so only what the
     * caller changed is dirty, and `ItemOrderTest` holds that).
     *
     * @param  Builder<WorkItem>  $query
     * @param  string|null  $group  the group the page lists (`group_by:key`), so that a cursor of another group is refused
     * @return CursorPaginator<int, WorkItem>
     *
     * @throws ValidationException at `cursor`
     */
    public static function page(Builder $query, SortSpec $sort, PageArgs $args, ?string $group = null): CursorPaginator
    {
        $keys = self::prepare($query, $sort);
        $natural = in_array('natural', array_column($keys, 'kind'), true);
        $signature = $sort->signature().($natural ? self::NATURAL_SIGNATURE : '').($group === null ? '' : '|'.$group);
        $cursor = self::cursor($args->cursor, $keys, $signature);
        $back = $cursor !== null && $cursor->pointsToPreviousItems();

        $query->selectRaw('? as '.self::CURSOR_SIGNATURE, [$signature]);
        if ($cursor !== null) {
            $query->where(fn (Builder $where) => self::beyond($where, $keys, $cursor, $back));
        }
        self::order($query, $keys, $back);

        return new CursorPaginator($query->limit($args->perPage + 1)->get(), $args->perPage, $cursor, [
            'path' => Paginator::resolveCurrentPath(),
            'cursorName' => 'cursor',
            'parameters' => [...array_column($keys, 'name'), self::CURSOR_SIGNATURE],
        ]);
    }

    /**
     * Only the order, without a page (the timeline loads every item, groups count them); the query changes with it, an
     * order it brings goes.
     *
     * @param  Builder<WorkItem>  $query
     * @return Builder<WorkItem>
     */
    public static function apply(Builder $query, SortSpec $sort): Builder
    {
        self::order($query, self::prepare($query, $sort), false);

        return $query;
    }

    /**
     * Joins and selects the keys of the sort.
     *
     * @param  Builder<WorkItem>  $query
     * @return list<array{name: string, sql: literal-string, bindings: list<mixed>, descending: bool, kind: string, order: string}>
     */
    private static function prepare(Builder $query, SortSpec $sort): array
    {
        $desc = $sort->descending;

        $values = match ($sort->field) {
            'rank' => [],
            'priority' => [self::position('`work_items`.`priority`', array_map(fn (Priority $p) => $p->value, Priority::ORDER), $desc)],
            'due_date' => self::emptyLast('`work_items`.`due_date`', [], "date '0001-01-01'", 'day', $desc),
            'start_date' => self::emptyLast('`work_items`.`start_date`', [], "date '0001-01-01'", 'day', $desc),
            // the stamps are required (A440): the column itself, so the keyset condition is a range on its index
            'created_at' => [self::key('`work_items`.`created_at`', [], $desc, 'stamp')],
            'updated_at' => [self::key('`work_items`.`updated_at`', [], $desc, 'stamp')],
            'key' => self::projectKey($query, $desc),
            'state_category' => self::category($query, $desc),
            default => self::property($query, $sort->field, $desc),
        };

        if ($query->getQuery()->columns === null) {
            $query->select('work_items.*');
        }
        $keys = [];
        foreach ($values as $index => $value) {
            // `sort_0`, `sort_1`: an alias of ours, never input
            /** @var literal-string $name */
            $name = "sort_{$index}";
            $query->addSelect(new Expression($value['sql'].' as '.$name))->addBinding($value['bindings'], 'select');
            $keys[] = [...$value, 'name' => $name, 'order' => $name];
        }

        // the manual order turns its rank; every other sort ends on the rank ascending
        $rank = $sort->field === 'rank' && $desc;
        $keys[] = [...self::key('`work_items`.`rank`', [], $rank, 'text'), 'name' => 'rank', 'order' => 'work_items.rank'];
        $keys[] = [...self::key('`work_items`.`id`', [], false, 'text'), 'name' => 'id', 'order' => 'work_items.id'];

        return $keys;
    }

    /**
     * @param  Builder<WorkItem>  $query
     * @param  list<array{name: string, sql: literal-string, bindings: list<mixed>, descending: bool, kind: string, order: string}>  $keys
     */
    private static function order(Builder $query, array $keys, bool $back): void
    {
        // the keys are the whole order: one the query brought would stand before them and break the cursor
        $query->reorder();
        foreach ($keys as $key) {
            $query->orderBy($key['order'], $key['descending'] !== $back ? 'desc' : 'asc');
        }
    }

    /**
     * The rows after the cursor in the order of the keys (before it, with `$back`).
     *
     * @param  Builder<WorkItem>  $query
     * @param  list<array{name: string, sql: literal-string, bindings: list<mixed>, descending: bool, kind: string, order: string}>  $keys
     */
    private static function beyond(Builder $query, array $keys, Cursor $cursor, bool $back): void
    {
        foreach ($keys as $index => $key) {
            $query->orWhere(function (Builder $all) use ($keys, $index, $key, $cursor, $back) {
                foreach (array_slice($keys, 0, $index) as $equal) {
                    $all->whereRaw(new Expression($equal['sql'].' = '.self::placeholder($equal['kind'])), [...$equal['bindings'], $cursor->parameter($equal['name'])]);
                }
                $operator = $key['descending'] !== $back ? '<' : '>';
                $all->whereRaw(new Expression($key['sql'].' '.$operator.' '.self::placeholder($key['kind'])), [...$key['bindings'], $cursor->parameter($key['name'])]);
            });
        }
    }

    /**
     * The cursor of the request, checked against the keys and the signature of this order.
     *
     * @param  list<array{name: string, sql: literal-string, bindings: list<mixed>, descending: bool, kind: string, order: string}>  $keys
     *
     * @throws ValidationException at `cursor`
     */
    private static function cursor(?string $encoded, array $keys, string $signature): ?Cursor
    {
        if ($encoded === null || $encoded === '') {
            return null;
        }

        // the encoding of `Cursor::encode()`: JSON in base64 for URLs, without padding
        $parameters = json_decode((string) base64_decode(strtr($encoded, '-_', '+/')), true);
        $names = [...array_column($keys, 'name'), self::CURSOR_SIGNATURE, '_pointsToNextItems'];
        $fits = is_array($parameters)
            && count($parameters) === count($names)
            && array_diff($names, array_map('strval', array_keys($parameters))) === []
            && $parameters[self::CURSOR_SIGNATURE] === $signature
            && is_bool($parameters['_pointsToNextItems']);
        foreach ($fits ? $keys : [] as $key) {
            $fits = $fits && self::fits($key['kind'], $parameters[$key['name']]);
        }
        if (! $fits) {
            throw ValidationException::withMessages(['cursor' => __('field.cursor.invalid')]);
        }

        $next = $parameters['_pointsToNextItems'];
        unset($parameters['_pointsToNextItems']);

        return new Cursor($parameters, $next);
    }

    /** Whether a value of the cursor has the form the database gave the key. */
    private static function fits(string $kind, mixed $value): bool
    {
        return match ($kind) {
            'mark' => $value === 0 || $value === 1,
            'int' => is_int($value),
            'decimal' => is_string($value) && preg_match('/\A-?\d{1,20}\.\d{4}\z/', $value) === 1,
            'day' => is_string($value) && preg_match('/\A\d{4}-\d{2}-\d{2}\z/', $value) === 1,
            'stamp' => is_string($value) && preg_match('/\A\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}\z/', $value) === 1,
            default => is_string($value),
        };
    }

    /**
     * How a value of the cursor is bound: numbers as exact decimals (a text would compare as a float), days as days.
     *
     * @return literal-string
     */
    private static function placeholder(string $kind): string
    {
        return match ($kind) {
            'decimal' => 'cast(? as decimal(24,4))',
            'day' => 'cast(? as date)',
            default => '?',
        };
    }

    /**
     * The identifier of the project (naturally: `A2` before `A10`) and the number.
     *
     * @param  Builder<WorkItem>  $query
     * @return list<array{sql: literal-string, bindings: list<mixed>, descending: bool, kind: string}>
     */
    private static function projectKey(Builder $query, bool $desc): array
    {
        $query->join('projects as sort_projects', 'sort_projects.id', '=', 'work_items.project_id');

        return [self::natural('`sort_projects`.`identifier`', [], $desc), self::key('`work_items`.`number`', [], $desc, 'int')];
    }

    /**
     * The category of the state, from backlog to canceled.
     *
     * @param  Builder<WorkItem>  $query
     * @return list<array{sql: literal-string, bindings: list<mixed>, descending: bool, kind: string}>
     */
    private static function category(Builder $query, bool $desc): array
    {
        $query->join('workflow_states as sort_states', 'sort_states.id', '=', 'work_items.state_id');

        return [self::position('`sort_states`.`category`', array_map(fn (StateCategory $c) => $c->value, StateCategory::ORDER), $desc)];
    }

    /**
     * The first value (`position` 0) of a property of the types number, date, text and address, of an item whose type
     * has the property; any other field (a stored sort whose property went) is the manual order. The value is joined
     * once (`sort_values`, at most one row per item by the unique index), not read as a subquery per key: the mark and
     * the value would read it twice per item (Task 10a).
     *
     * @param  Builder<WorkItem>  $query
     * @return list<array{sql: literal-string, bindings: list<mixed>, descending: bool, kind: string}>
     */
    private static function property(Builder $query, string $field, bool $desc): array
    {
        $property = Field::named($field, app(CatalogProperties::class));
        $values = self::PROPERTY_VALUES[$property?->propertyType->value ?? ''] ?? null;
        if ($property === null || $values === null) {
            return [];
        }

        [$column, $guard, $kind] = $values;
        $query->leftJoin('work_item_values as sort_values', fn (JoinClause $join) => $join
            ->on('sort_values.work_item_id', '=', 'work_items.id')
            ->where('sort_values.position', '=', 0)
            ->whereRaw('`sort_values`.`property_id` = (select `sort_properties`.`id` from `properties` as `sort_properties` where `sort_properties`.`key` = ?)', [(string) $property->propertyKey])
            // a value left from a type the item no longer has is no value
            ->whereRaw('exists (select 1 from `type_properties` as `sort_types`'
                .' where `sort_types`.`type_id` = `work_items`.`type_id` and `sort_types`.`property_id` = `sort_values`.`property_id`)'));

        return self::emptyLast("`sort_values`.`{$column}`", [], $guard, $kind, $desc);
    }

    /**
     * The mark of an empty value (always ascending) and the value with a guard.
     *
     * @param  literal-string  $sql
     * @param  literal-string  $guard
     * @param  list<mixed>  $bindings
     * @return list<array{sql: literal-string, bindings: list<mixed>, descending: bool, kind: string}>
     */
    private static function emptyLast(string $sql, array $bindings, string $guard, string $kind, bool $desc): array
    {
        $value = "coalesce({$sql}, {$guard})";

        return [
            self::key("({$sql} is null)", $bindings, false, 'mark'),
            $kind === 'natural' ? self::natural($value, $bindings, $desc) : self::key($value, $bindings, $desc, $kind),
        ];
    }

    /**
     * The natural sort key of a text (A450): every number in it with the count of its digits before it, so it compares
     * as a number; under the collation of the text, so case and accents count as little as elsewhere.
     *
     * @param  literal-string  $sql
     * @param  list<mixed>  $bindings
     * @return array{sql: literal-string, bindings: list<mixed>, descending: bool, kind: string}
     */
    private static function natural(string $sql, array $bindings, bool $desc): array
    {
        return self::key("natural_sort_key({$sql})", $bindings, $desc, 'natural');
    }

    /**
     * The place of a word in a fixed order, from 1 (`field(…)`; a word outside it would be 0).
     *
     * @param  literal-string  $sql
     * @param  list<string>  $order
     * @return array{sql: literal-string, bindings: list<mixed>, descending: bool, kind: string}
     */
    private static function position(string $sql, array $order, bool $desc): array
    {
        return self::key("field({$sql}, ".implode(', ', array_fill(0, count($order), '?')).')', $order, $desc, 'int');
    }

    /**
     * @param  literal-string  $sql
     * @param  list<mixed>  $bindings
     * @return array{sql: literal-string, bindings: list<mixed>, descending: bool, kind: string}
     */
    private static function key(string $sql, array $bindings, bool $descending, string $kind): array
    {
        return ['sql' => $sql, 'bindings' => $bindings, 'descending' => $descending, 'kind' => $kind];
    }
}
