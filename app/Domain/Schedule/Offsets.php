<?php

namespace App\Domain\Schedule;

use App\Domain\WorkItems\DateRange;
use DateTimeImmutable;
use DateTimeZone;
use InvalidArgumentException;

/**
 * The start and due date of an item from a template (spec 4.12): days relative to the day it is created on.
 */
final class Offsets
{
    /**
     * The day `offset` days after `today`; null without an offset. Days have no zone, so the change of the clocks
     * never moves them.
     */
    public static function day(string $today, ?int $offset): ?string
    {
        if (! DateRange::isDay($today)) {
            throw new InvalidArgumentException("\"{$today}\" is no day of the calendar.");
        }
        if ($offset === null) {
            return null;
        }

        return (new DateTimeImmutable($today, new DateTimeZone('UTC')))->modify("{$offset} days")->format('Y-m-d');
    }
}
