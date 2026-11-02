<?php

namespace App\Views;

use App\Domain\Filter\Condition;
use App\Domain\Filter\CoreField;
use App\Domain\Filter\DayRange;
use App\Domain\Filter\Field;
use App\Domain\Filter\FieldKind;
use App\Domain\Filter\Filter;
use App\Domain\Filter\Op;
use App\Domain\Filter\Operand;
use App\Domain\Filter\Operands;
use App\Domain\Filter\Scalar;
use App\Domain\Properties\FieldType;
use App\Domain\Time\OrgCalendar;
use App\Domain\Workflow\StateCategory;
use App\Models\User;
use App\Models\WorkItem;
use Closure;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Database\Query\Builder as QueryBuilder;
use Illuminate\Database\Query\Expression;
use Illuminate\Support\Facades\DB;

/**
 * A filter as conditions of an item query (master plan, contract "Filter"): what `matchesFilter` of the clickdummy
 * decides for one item, decided by the database for all of them. Every condition is one `where`; a condition that
 * names no field (any more) matches nothing. The query asks nothing before it is read.
 *
 * - Ids and words compare their column; a missing value is never equal, so `is_not`/`not_in` keep the items without
 *   one (`col is null or col not in …`). The category of the state and the labels go through subqueries.
 * - Days compare as days; timestamps by their day in the time zone of the organisation, as half-open UTC intervals
 *   from the start of a day to the start of the next (`OrgCalendar::dayStart`, so a day of 23 or 25 hours is right).
 *   A range of days (`this_week`) is inside for `is`, before its first day for `before`, after its last for `after`.
 * - Flags are `exists` (or the scalar `WorkItem::blocks`); `is false` is the negation, so it keeps every other item.
 * - A property never matches an item whose type does not have it, whatever the operator (`is_empty`, `is_not`,
 *   `not_in` and `is false` included; spec, changes of 2026-10-29): every property condition starts with the types of
 *   the property. Its values are rows of `work_item_values` (`exists`/`not exists`), and an empty value is no row
 *   (ItemValues stores none), so `is_empty` is "no row" and `is_not`/`not_in` "no row with the value". Yes or no reads
 *   `false` and no value alike (A89): `is false` is "no row that says yes". Numbers are bound as their decimal text
 *   with the four decimals of the column (a float would go with 14 digits), rich text is searched in `value_text`.
 * - Columns are always qualified (`work_items.…`, K3): sorts join projects and states.
 */
final class FilterQuery
{
    /**
     * @param  Builder<WorkItem>  $query
     * @return Builder<WorkItem>
     */
    public static function apply(Builder $query, Filter $filter, User $viewer): Builder
    {
        $calendar = Calendar::current();

        foreach ($filter->conditions as $condition) {
            $query->where(fn (Builder $where) => self::condition($where, $condition, $viewer, $calendar));
        }

        return $query;
    }

    /**
     * @param  Builder<WorkItem>  $query
     */
    private static function condition(Builder $query, Condition $condition, User $viewer, OrgCalendar $calendar): void
    {
        $field = $condition->resolved;
        if ($field === null) {
            self::nothing($query);

            return;
        }

        $op = $condition->op;
        $one = fn (mixed $value): ?Operand => Operands::one($value, $field, $viewer->id, $calendar);
        $operands = Operands::of($condition->value, $field, $viewer->id, $calendar);
        if (self::takesTexts($field->kind) && array_filter(self::scalars($operands), fn (mixed $value) => ! is_string($value)) !== []) {
            // ids and words are texts; a number or yes or no would be compared numerically with a text column and
            // meet nearly every row (`'01k…' = 1`), so it meets none (only conditions made by hand get here)
            self::nothing($query);

            return;
        }
        $core = CoreField::tryFrom($field->name);
        if ($core === null) {
            self::property($query, $field, $op, $condition->value, $operands, $one, $calendar);

            return;
        }

        match ($field->kind) {
            FieldKind::Id, FieldKind::Enum => self::choice($query, $core, $op, self::scalars($operands)),
            FieldKind::List => self::labels($query, $op, self::scalars($operands)),
            FieldKind::Date, FieldKind::Stamp => self::days($query, $core, $op, $condition->value, $operands, $one, $calendar),
            FieldKind::Flag => self::flag($query, $core, $op, $operands, $viewer),
            // the title, the one core field of text (numbers and rich text are properties)
            default => self::title($query, $op, $operands),
        };
    }

    /**
     * A field of one id or word: project, type, state, people, parent, priority, the category of the state.
     *
     * @param  Builder<WorkItem>  $query
     * @param  list<string|int|float|bool>  $values
     */
    private static function choice(Builder $query, CoreField $field, Op $op, array $values): void
    {
        $category = $field === CoreField::StateCategory;
        $column = $query->qualifyColumn($category ? 'state_id' : self::column($field));
        $set = $category ? self::statesIn($values) : $values;

        match ($op) {
            Op::Is, Op::In => $query->whereIn($column, $set),
            Op::IsNot, Op::NotIn => $field->nullable()
                ? $query->where(fn (Builder $or) => $or->whereNull($column)->orWhereNotIn($column, $set))
                : $query->whereNotIn($column, $set),
            Op::IsEmpty => $query->whereNull($column),
            Op::IsNotEmpty => $query->whereNotNull($column),
            default => self::nothing($query),
        };
    }

    /**
     * The labels: `is`, `in` and `contains` mean "has one of them", `is_not`/`not_in` "has none of them".
     *
     * @param  Builder<WorkItem>  $query
     * @param  list<string|int|float|bool>  $ids
     */
    private static function labels(Builder $query, Op $op, array $ids): void
    {
        $labels = fn (?array $ids) => DB::query()->from('work_item_labels')
            ->whereColumn('work_item_labels.work_item_id', $query->qualifyColumn('id'))
            ->when($ids !== null, fn (QueryBuilder $labels) => $labels->whereIn('work_item_labels.label_id', (array) $ids));

        match ($op) {
            Op::Is, Op::In, Op::Contains => $query->whereExists($labels($ids)),
            Op::IsNot, Op::NotIn => $query->whereNotExists($labels($ids)),
            Op::IsEmpty => $query->whereNotExists($labels(null)),
            Op::IsNotEmpty => $query->whereExists($labels(null)),
            default => self::nothing($query),
        };
    }

    /**
     * A day (start and due date) or the day of a timestamp, both through where a day starts: the day itself for a
     * date column, its first instant in UTC for a timestamp.
     *
     * @param  Builder<WorkItem>  $query
     * @param  list<Operand>  $operands
     * @param  callable(mixed): ?Operand  $one
     */
    private static function days(Builder $query, CoreField $field, Op $op, mixed $value, array $operands, callable $one, OrgCalendar $calendar): void
    {
        $column = $query->qualifyColumn(self::column($field));
        $start = fn (string $day): string => $field->kind() === FieldKind::Stamp ? $calendar->dayStart($day)->format('Y-m-d H:i:s') : $day;
        $inside = self::dayCondition($column, $op, $value, $operands, $one, $start, $calendar);

        match (true) {
            $op === Op::IsEmpty => $query->whereNull($column),
            $op === Op::IsNotEmpty => $query->whereNotNull($column),
            $op === Op::Overdue => $query->where($column, '<', $start($calendar->today()))
                ->whereNotIn($query->qualifyColumn('state_id'), self::statesIn(self::closedCategories())),
            $inside !== null => $inside($query->getQuery()),
            default => self::nothing($query),
        };
    }

    /**
     * The condition of `is`, `before`, `after` or `between` on a column of days, through where a day starts (`$start`)
     * and the next one; `null` for any other operator and for a value it cannot read as days.
     *
     * @param  list<Operand>  $operands
     * @param  callable(mixed): ?Operand  $one
     * @param  callable(string): string  $start
     * @return (Closure(QueryBuilder): mixed)|null
     */
    private static function dayCondition(string $column, Op $op, mixed $value, array $operands, callable $one, callable $start, OrgCalendar $calendar): ?Closure
    {
        $next = fn (string $day): string => $start($calendar->addDays($day, 1));
        $range = fn (mixed $value): ?DayRange => ($operand = $one($value)) instanceof DayRange ? $operand : null;
        $ranges = array_values(array_filter($operands, fn (Operand $operand) => $operand instanceof DayRange));
        $bound = $range($value);
        $ends = is_array($value) && array_is_list($value) && count($value) === 2 ? [$range($value[0]), $range($value[1])] : [null, null];

        return match (true) {
            $op === Op::Is && $ranges !== [] => fn (QueryBuilder $query) => $query->where(function (QueryBuilder $any) use ($ranges, $column, $start, $next) {
                foreach ($ranges as $days) {
                    $any->orWhere(fn (QueryBuilder $inside) => $inside->where($column, '>=', $start($days->from))->where($column, '<', $next($days->to)));
                }
            }),
            $op === Op::Before && $bound !== null => fn (QueryBuilder $query) => $query->where($column, '<', $start($bound->from)),
            $op === Op::After && $bound !== null => fn (QueryBuilder $query) => $query->where($column, '>=', $next($bound->to)),
            $op === Op::Between && $ends[0] !== null && $ends[1] !== null => fn (QueryBuilder $query) => $query
                ->where($column, '>=', $start($ends[0]->from))->where($column, '<', $next($ends[1]->to)),
            default => null,
        };
    }

    /**
     * A flag, `is true` or `is false`; false is the negation of true.
     *
     * @param  Builder<WorkItem>  $query
     * @param  list<Operand>  $operands
     */
    private static function flag(Builder $query, CoreField $field, Op $op, array $operands, User $viewer): void
    {
        $flag = count($operands) === 1 ? $operands[0] : null;
        if ($op !== Op::Is || ! $flag instanceof Scalar || ! is_bool($flag->value)) {
            self::nothing($query);

            return;
        }

        $on = $flag->value;
        $id = $query->qualifyColumn('id');
        $exists = fn (QueryBuilder $rows) => $on ? $query->whereExists($rows) : $query->whereNotExists($rows);

        match ($field) {
            CoreField::HasChildren => $exists(DB::query()->from('work_items as children')->whereColumn('children.parent_id', $id)),
            CoreField::Blocked, CoreField::Blocking => self::blocks($query, WorkItem::blocks($query, $field === CoreField::Blocking), $on),
            CoreField::Archived => $on ? $query->whereNotNull($query->qualifyColumn('archived_at')) : $query->whereNull($query->qualifyColumn('archived_at')),
            CoreField::Epic => $on ? $query->whereIn($query->qualifyColumn('type_id'), self::epicTypes()) : $query->whereNotIn($query->qualifyColumn('type_id'), self::epicTypes()),
            // subscribed
            default => $exists(DB::query()->from('work_item_subscribers')->whereColumn('work_item_subscribers.work_item_id', $id)
                ->where('work_item_subscribers.user_id', $viewer->id)->whereNull('work_item_subscribers.unsubscribed_at')),
        };
    }

    /**
     * The title contains a text: through the collation (case and accents aside), `%`, `_` and `\` taken literally.
     *
     * @param  Builder<WorkItem>  $query
     * @param  list<Operand>  $operands
     */
    private static function title(Builder $query, Op $op, array $operands): void
    {
        $text = count($operands) === 1 && $operands[0] instanceof Scalar ? $operands[0]->value : null;
        if ($op !== Op::Contains || ! is_string($text)) {
            self::nothing($query);

            return;
        }

        $query->where($query->qualifyColumn('title'), 'like', self::like($text));
    }

    /**
     * A condition on a property: only items of a type that has it, then its value rows (`work_item_values`) by field
     * type. An empty value is no row.
     *
     * @param  Builder<WorkItem>  $query
     * @param  list<Operand>  $operands
     * @param  callable(mixed): ?Operand  $one
     */
    private static function property(Builder $query, Field $field, Op $op, mixed $value, array $operands, callable $one, OrgCalendar $calendar): void
    {
        $property = fn (): QueryBuilder => DB::query()->select('properties.id')->from('properties')->where('properties.key', (string) $field->propertyKey);
        $query->whereIn($query->qualifyColumn('type_id'), DB::query()->select('type_properties.type_id')->from('type_properties')
            ->whereIn('type_properties.property_id', $property()));

        $rows = fn (): QueryBuilder => DB::query()->from('work_item_values')
            ->whereColumn('work_item_values.work_item_id', $query->qualifyColumn('id'))
            ->whereIn('work_item_values.property_id', $property());
        // a value row that meets the condition (`null` when there is none to ask for) exists, or does not
        $exists = fn (?Closure $where, bool $on = true) => match (true) {
            $where === null => self::nothing($query),
            $on => $query->whereExists(tap($rows(), $where)),
            default => $query->whereNotExists(tap($rows(), $where)),
        };

        match (true) {
            $op === Op::IsEmpty => $query->whereNotExists($rows()),
            $op === Op::IsNotEmpty => $query->whereExists($rows()),
            default => match ($field->propertyType) {
                FieldType::Dropdown, FieldType::Member => self::propertyChoice($exists, $field->propertyType, $op, self::scalars($operands)),
                FieldType::Boolean => self::propertyFlag($exists, $op, $operands),
                FieldType::Number => $exists(self::numberCondition($op, $operands)),
                FieldType::Date => $exists(self::dayCondition('work_item_values.value_date', $op, $value, $operands, $one, fn (string $day) => $day, $calendar)),
                FieldType::Text, FieldType::Url => $exists(self::textCondition('work_item_values.value_string', $op, $operands, true)),
                // rich text, searched in its plain text
                default => $exists(self::textCondition('work_item_values.value_text', $op, $operands, false)),
            },
        };
    }

    /**
     * An option or a person, one or several: `is`, `in` and `contains` mean "has one of them", `is_not`/`not_in`
     * "has none of them".
     *
     * @param  callable(?Closure, bool=): mixed  $exists
     * @param  list<string|int|float|bool>  $ids
     */
    private static function propertyChoice(callable $exists, FieldType $type, Op $op, array $ids): void
    {
        $column = $type === FieldType::Dropdown ? 'work_item_values.value_option_id' : 'work_item_values.value_user_id';
        $in = fn (QueryBuilder $rows) => $rows->whereIn($column, $ids);

        match ($op) {
            Op::Is, Op::In, Op::Contains => $exists($in),
            Op::IsNot, Op::NotIn => $exists($in, false),
            default => $exists(null),
        };
    }

    /**
     * Yes or no, `is true` or `is false`: no value reads as no (A89), so false is "no row that says yes".
     *
     * @param  callable(?Closure, bool=): mixed  $exists
     * @param  list<Operand>  $operands
     */
    private static function propertyFlag(callable $exists, Op $op, array $operands): void
    {
        $flag = count($operands) === 1 && $operands[0] instanceof Scalar && is_bool($operands[0]->value) ? $operands[0]->value : null;
        $yes = fn (QueryBuilder $rows) => $rows->where('work_item_values.value_bool', true);

        $exists($op === Op::Is && $flag !== null ? $yes : null, $flag === true);
    }

    /**
     * `is`, `gt`, `lt` and `between` (both ends included) of a number, bound as its decimal text with the four decimals
     * of `value_number` (`decimal(24,4)`): a float goes to the database with 14 digits (`precision`) and would miss
     * larger numbers; the text compares as a decimal. More decimals round to four. `null` for anything else.
     *
     * @param  list<Operand>  $operands
     * @return (Closure(QueryBuilder): mixed)|null
     */
    private static function numberCondition(Op $op, array $operands): ?Closure
    {
        $numbers = array_values(array_map(
            fn (int|float $number) => sprintf('%.4F', $number),
            array_filter(self::scalars($operands), fn (mixed $value) => is_int($value) || is_float($value)),
        ));
        $column = 'work_item_values.value_number';

        return match (true) {
            count($numbers) === 1 && $op === Op::Is => fn (QueryBuilder $rows) => $rows->where($column, '=', $numbers[0]),
            count($numbers) === 1 && $op === Op::Gt => fn (QueryBuilder $rows) => $rows->where($column, '>', $numbers[0]),
            count($numbers) === 1 && $op === Op::Lt => fn (QueryBuilder $rows) => $rows->where($column, '<', $numbers[0]),
            count($numbers) === 2 && $op === Op::Between => fn (QueryBuilder $rows) => $rows->where($column, '>=', $numbers[0])->where($column, '<=', $numbers[1]),
            default => null,
        };
    }

    /**
     * A text contains a text (`like`, see like()), or is one (`$is`, only text and URL properties): both through the
     * collation, so case and accents aside. `null` for anything else.
     *
     * @param  list<Operand>  $operands
     * @return (Closure(QueryBuilder): mixed)|null
     */
    private static function textCondition(string $column, Op $op, array $operands, bool $is): ?Closure
    {
        $text = count($operands) === 1 && $operands[0] instanceof Scalar ? $operands[0]->value : null;

        return match (true) {
            ! is_string($text) => null,
            $op === Op::Contains => fn (QueryBuilder $rows) => $rows->where($column, 'like', self::like($text)),
            $op === Op::Is && $is => fn (QueryBuilder $rows) => $rows->where($column, '=', $text),
            default => null,
        };
    }

    /** The pattern of `like` for "contains the text": `%`, `_` and `\` taken literally. */
    private static function like(string $text): string
    {
        return '%'.str_replace(['\\', '%', '_'], ['\\\\', '\\%', '\\_'], $text).'%';
    }

    /**
     * The scalar subquery of WorkItem::blocks() (`count(*) > 0`) is true or false.
     *
     * @param  Builder<WorkItem>  $query
     */
    private static function blocks(Builder $query, QueryBuilder $blocks, bool $on): void
    {
        // `1 = (subquery)`: the subquery on the side of the value, where the types of Laravel take it
        $query->where(new Expression($on ? '1' : '0'), '=', $blocks);
    }

    /**
     * The column of a core field that is one: `<field>_id` for the ids of a single row, the name itself otherwise.
     */
    private static function column(CoreField $field): string
    {
        return in_array($field, [CoreField::Project, CoreField::Type, CoreField::State, CoreField::Assignee, CoreField::Parent], true)
            ? "{$field->value}_id"
            : $field->value;
    }

    /**
     * @param  Builder<WorkItem>  $query
     */
    private static function nothing(Builder $query): void
    {
        $query->whereRaw('0 = 1');
    }

    /**
     * The states of these categories, as a subquery.
     *
     * @param  list<string|int|float|bool>  $categories
     */
    private static function statesIn(array $categories): QueryBuilder
    {
        return DB::query()->select('id')->from('workflow_states')->whereIn('category', $categories);
    }

    private static function epicTypes(): QueryBuilder
    {
        return DB::query()->select('id')->from('work_item_types')->where('is_epic', true);
    }

    /** Whether the values of the kind are ids or words, texts all of them. */
    private static function takesTexts(FieldKind $kind): bool
    {
        return $kind === FieldKind::Id || $kind === FieldKind::Enum || $kind === FieldKind::List;
    }

    /**
     * The plain values of the operands.
     *
     * @param  list<Operand>  $operands
     * @return list<string|int|float|bool>
     */
    private static function scalars(array $operands): array
    {
        return array_values(array_map(
            fn (Scalar $operand) => $operand->value,
            array_filter($operands, fn (Operand $operand) => $operand instanceof Scalar),
        ));
    }

    /**
     * @return list<string>
     */
    private static function closedCategories(): array
    {
        return array_values(array_map(
            fn (StateCategory $category) => $category->value,
            array_filter(StateCategory::cases(), fn (StateCategory $category) => $category->isClosed()),
        ));
    }
}
