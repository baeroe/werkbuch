<?php

namespace App\Domain\Filter;

/**
 * The operators of a filter condition (spec 4.11), named like `ConditionOp` of the clickdummy.
 */
enum Op: string
{
    case Is = 'is';
    case IsNot = 'is_not';
    case In = 'in';
    case NotIn = 'not_in';
    case IsEmpty = 'is_empty';
    case IsNotEmpty = 'is_not_empty';
    case Before = 'before';
    case After = 'after';
    case Between = 'between';
    case Contains = 'contains';
    case Gt = 'gt';
    case Lt = 'lt';
    case Overdue = 'overdue';

    /** Whether the condition carries a value; `is_empty`, `is_not_empty` and `overdue` do not. */
    public function takesValue(): bool
    {
        return $this !== self::IsEmpty && $this !== self::IsNotEmpty && $this !== self::Overdue;
    }
}
