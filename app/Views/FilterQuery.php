<?php

namespace App\Views;

use App\Domain\Filter\Condition;
use App\Domain\Filter\CoreField;
use App\Domain\Filter\DayRange;
use App\Domain\Filter\FieldKind;
use App\Domain\Filter\Filter;
use App\Domain\Filter\Op;
use App\Domain\Filter\Operand;
use App\Domain\Filter\Operands;
use App\Domain\Filter\Scalar;
use App\Domain\Time\OrgCalendar;
use App\Domain\Workflow\StateCategory;
use App\Models\User;
use App\Models\WorkItem;
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
 * - Columns are always qualified (`work_items.…`, K3): sorts join projects and states.
 *
 * Conditions on properties come with Task 4; until then they match nothing.
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
        $core = $field === null ? null : CoreField::tryFrom($field->name);
        if ($field === null || $core === null) {
            self::nothing($query);

            return;
        }

        $op = $condition->op;
        $one = fn (mixed $value): ?Operand => Operands::one($value, $field, $viewer->id, $calendar);
        $operands = Operands::of($condition->value, $field, $viewer->id, $calendar);

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
        $next = fn (string $day): string => $start($calendar->addDays($day, 1));
        $range = fn (mixed $value): ?DayRange => ($operand = $one($value)) instanceof DayRange ? $operand : null;
        $ranges = array_values(array_filter($operands, fn (Operand $operand) => $operand instanceof DayRange));
        $bound = $range($value);
        $ends = is_array($value) && array_is_list($value) && count($value) === 2 ? [$range($value[0]), $range($value[1])] : [null, null];

        match (true) {
            $op === Op::Is && $ranges !== [] => $query->where(function (Builder $any) use ($ranges, $column, $start, $next) {
                foreach ($ranges as $days) {
                    $any->orWhere(fn (Builder $inside) => $inside->where($column, '>=', $start($days->from))->where($column, '<', $next($days->to)));
                }
            }),
            $op === Op::Before && $bound !== null => $query->where($column, '<', $start($bound->from)),
            $op === Op::After && $bound !== null => $query->where($column, '>=', $next($bound->to)),
            $op === Op::Between && $ends[0] !== null && $ends[1] !== null => $query
                ->where($column, '>=', $start($ends[0]->from))->where($column, '<', $next($ends[1]->to)),
            $op === Op::IsEmpty => $query->whereNull($column),
            $op === Op::IsNotEmpty => $query->whereNotNull($column),
            $op === Op::Overdue => $query->where($column, '<', $start($calendar->today()))
                ->whereNotIn($query->qualifyColumn('state_id'), self::statesIn(self::closedCategories())),
            default => self::nothing($query),
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

        $query->where($query->qualifyColumn('title'), 'like', '%'.str_replace(['\\', '%', '_'], ['\\\\', '\\%', '\\_'], $text).'%');
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
