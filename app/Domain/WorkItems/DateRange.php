<?php

namespace App\Domain\WorkItems;

/**
 * The start and due date of an item (spec 4.4): days without time and zone, `YYYY-MM-DD`.
 */
final class DateRange
{
    /** The form of a day; the end of the text, not of a line. */
    public const DAY = '/^\d{4}-\d{2}-\d{2}\z/';

    /** Whether the text is a day of the calendar in the form `YYYY-MM-DD` (no 30 February). */
    public static function isDay(string $value): bool
    {
        if (preg_match(self::DAY, $value) !== 1) {
            return false;
        }
        [$year, $month, $day] = array_map(intval(...), explode('-', $value));

        return checkdate($month, $day, $year);
    }

    /** Whether the start lies after the due date; false when one of them is missing. Days compare as text. */
    public static function startAfterDue(?string $start, ?string $due): bool
    {
        return $start !== null && $due !== null && strcmp($start, $due) > 0;
    }
}
