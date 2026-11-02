<?php

namespace App\Domain\Filter;

/**
 * The kinds of filter fields (plan, table "Filter-Schema"): which operators a field offers and which values it takes.
 */
enum FieldKind: string
{
    /** One ULID per item: project, type, state, people, parent, a single choice. */
    case Id = 'id';
    /** One fixed word per item: the category of the state, the priority. */
    case Enum = 'enum';
    /** Several ULIDs per item: labels, a multiple choice. */
    case List = 'list';
    /** A day: start and due date, a date property. */
    case Date = 'date';
    /** A timestamp, compared by its day in the time zone of the organisation. */
    case Stamp = 'stamp';
    /** Yes or no. */
    case Flag = 'flag';
    case Text = 'text';
    case Number = 'number';
    /** Rich text, searched in its plain text. */
    case Rich = 'rich';

    /**
     * Every operator the kind knows, in the order of the operator menu. `Field::ops()` narrows them for its field: the
     * empty checks only where an item can have no value, `overdue` only for the due date, the title only `contains`.
     *
     * @return list<Op>
     */
    public function ops(): array
    {
        $choices = [Op::Is, Op::IsNot, Op::In, Op::NotIn];
        $empties = [Op::IsEmpty, Op::IsNotEmpty];
        $days = [Op::Is, Op::Before, Op::After, Op::Between];

        return match ($this) {
            self::Id => [...$choices, ...$empties],
            self::Enum => $choices,
            self::List => [...$choices, ...$empties, Op::Contains],
            self::Date => [...$days, ...$empties, Op::Overdue],
            self::Stamp => [...$days, ...$empties],
            self::Flag => [Op::Is],
            self::Text => [Op::Contains, Op::Is, ...$empties],
            self::Number => [Op::Is, Op::Gt, Op::Lt, Op::Between, ...$empties],
            self::Rich => [Op::Contains, ...$empties],
        };
    }
}
