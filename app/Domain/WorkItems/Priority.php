<?php

namespace App\Domain\WorkItems;

/**
 * The priority of a work item (spec 4.4); `none` when nobody set one.
 */
enum Priority: string
{
    case Urgent = 'urgent';
    case High = 'high';
    case Medium = 'medium';
    case Low = 'low';
    case None = 'none';

    /** From the most to the least pressing: how lists sort and pickers show them. */
    public const ORDER = [self::Urgent, self::High, self::Medium, self::Low, self::None];
}
