<?php

namespace App\Domain\Filter;

use App\Domain\Time\OrgCalendar;
use App\Domain\WorkItems\DateRange;

/**
 * The dynamic values of a condition resolved (port of `toOperand`/`toOperands` of `filter.ts`): `me` becomes the
 * reader, `today`, `this_week`, `this_month`, `{relative: '+7d'}` and a day become ranges of days in the calendar of
 * the organisation; everything else stays the value it is.
 */
final class Operands
{
    /**
     * The operands of a condition value; one value counts as a list of one, values it cannot read are left out.
     *
     * @return list<Operand>
     */
    public static function of(mixed $value, string $me, OrgCalendar $calendar): array
    {
        $values = is_array($value) && array_is_list($value) ? $value : ($value === null ? [] : [$value]);

        return array_values(array_filter(array_map(fn (mixed $entry) => self::one($entry, $me, $calendar), $values)));
    }

    /** One value as an operand; `null` for a value it cannot read. */
    public static function one(mixed $value, string $me, OrgCalendar $calendar): ?Operand
    {
        if (is_int($value) || is_float($value) || is_bool($value)) {
            return new Scalar($value);
        }

        if (is_string($value)) {
            $today = $calendar->today();

            return match (true) {
                $value === 'me' => new Scalar($me),
                $value === 'today' => new DayRange($today, $today),
                $value === 'this_week' => new DayRange($calendar->startOfWeek($today), $calendar->addDays($calendar->startOfWeek($today), 6)),
                $value === 'this_month' => new DayRange($calendar->startOfMonth($today), $calendar->endOfMonth($today)),
                DateRange::isDay($value) => new DayRange($value, $value),
                default => new Scalar($value),
            };
        }

        $relative = is_array($value) ? ($value['relative'] ?? null) : null;
        if (! is_string($relative) || preg_match(FilterSchema::RELATIVE, $relative, $match) !== 1) {
            return null;
        }

        $day = $calendar->addDays($calendar->today(), (int) $match[2] * ($match[3] === 'w' ? 7 : 1) * ($match[1] === '-' ? -1 : 1));

        return new DayRange($day, $day);
    }
}
