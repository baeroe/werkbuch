<?php

namespace App\Domain\Schedule;

use App\Domain\WorkItems\DateRange;
use DateTimeImmutable;
use DateTimeZone;
use InvalidArgumentException;

/**
 * Wall-clock times in a zone (port of `toUtc` of `tz.ts`): a day `YYYY-MM-DD` and a time `HH:MM` become an instant in
 * UTC. A time in the gap of spring moves forward by the length of the gap (02:30 → 03:30 summer time); of an hour that
 * happens twice in autumn the first one counts (02:30 summer time). PHP alone would take the second one in Berlin and
 * the first one in New York, so the offsets around the time decide here, as in the clickdummy.
 */
final class WallClock
{
    /** A time of the wall clock, `HH:MM` from 00:00 to 23:59. */
    public const TIME = '/^([01]\d|2[0-3]):[0-5]\d\z/';

    private const SECONDS_PER_DAY = 86400;

    /** The instant, in UTC, the clocks of the zone show the time on the day. */
    public static function at(string $day, string $time, DateTimeZone $zone): DateTimeImmutable
    {
        if (! DateRange::isDay($day) || preg_match(self::TIME, $time) !== 1) {
            throw new InvalidArgumentException("\"{$day} {$time}\" is no wall-clock time.");
        }
        [$year, $month, $dayOfMonth] = array_map(intval(...), explode('-', $day));
        [$hour, $minute] = array_map(intval(...), explode(':', $time));

        // the wall-clock time read as if it were UTC; the offset of the zone turns it into the real instant
        $wall = (int) gmmktime($hour, $minute, 0, $month, $dayOfMonth, $year);
        $offsetBefore = self::offset($zone, $wall - self::SECONDS_PER_DAY);
        $offsetAfter = self::offset($zone, $wall + self::SECONDS_PER_DAY);

        $early = $wall - $offsetBefore;
        $late = $wall - $offsetAfter;
        $earlyHolds = self::offset($zone, $early) === $offsetBefore;
        $lateHolds = self::offset($zone, $late) === $offsetAfter;

        $instant = match (true) {
            // no switch near, or the time happens twice: the first one
            $earlyHolds && $lateHolds => min($early, $late),
            // only the new offset gives this time
            $lateHolds => $late,
            // only the old offset gives it, or none does (gap): the old offset moves the time forward by the gap
            default => $early,
        };

        return (new DateTimeImmutable("@{$instant}"))->setTimezone(new DateTimeZone('UTC'));
    }

    /** The day an instant falls on in the zone. */
    public static function day(DateTimeImmutable $instant, DateTimeZone $zone): string
    {
        return $instant->setTimezone($zone)->format('Y-m-d');
    }

    /** The offset of the zone from UTC at an instant, in seconds. */
    private static function offset(DateTimeZone $zone, int $instant): int
    {
        return $zone->getOffset(new DateTimeImmutable("@{$instant}"));
    }
}
