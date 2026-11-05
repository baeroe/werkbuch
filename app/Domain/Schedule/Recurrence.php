<?php

namespace App\Domain\Schedule;

use DateTimeImmutable;
use DateTimeZone;
use Generator;

/**
 * When the schedule of a template runs (spec 4.12, port of `recurrence.ts` of the clickdummy).
 *
 * A schedule works on the calendar of the zone it is given (the zone of the organisation): first the days it falls on
 * are worked out as plain days, then each of them gets the wall-clock time `time` in the zone (`WallClock::at`). That
 * is why a daily 09:00 stays at 09:00 on the wall clock when summer time starts or ends.
 *
 * Counting `interval`:
 * - daily: every N days from `startsOn`
 * - weekly: every N weeks, counted from the week (Monday to Sunday) of `startsOn`; days of that week before `startsOn`
 *   are skipped
 * - monthly: every N months from the month of `startsOn`
 * - yearly: every N years from the year of `startsOn`
 *
 * No run falls after `Schedule::LAST_DAY` (K4). Instants come back in UTC.
 */
final class Recurrence
{
    private const SECONDS_PER_DAY = 86400;

    /**
     * The next `count` runs after `after`, ascending. `runCount` is how often the schedule ran so far: one that ends
     * after N runs gives at most N − runCount more. A paused schedule gives none.
     *
     * @return list<DateTimeImmutable>
     */
    public static function next(Schedule $schedule, DateTimeImmutable $after, int $count, DateTimeZone $zone, int $runCount = 0): array
    {
        $limit = self::runLimit($schedule, $count, $runCount);
        if ($schedule->paused || $limit <= 0) {
            return [];
        }

        $runs = [];
        // start a day early: the local day of `after` may still hold a run later than `after`
        foreach (self::days($schedule, self::number(WallClock::day($after, $zone)) - 1) as $day) {
            $at = WallClock::at(self::text($day), $schedule->time, $zone);
            if ($at <= $after) {
                continue;
            }
            $runs[] = $at;
            if (count($runs) >= $limit) {
                break;
            }
        }

        return $runs;
    }

    /**
     * Of all the runs after `since` and up to `now`, the latest one: the single run to catch up when several were
     * missed (spec 4.12). Null when none is due. Without `since` the schedule counts from its start day. A paused
     * schedule, or one whose runs are used up (`runCount`), gives null. Never an instant at or before `since`.
     */
    public static function catchUp(Schedule $schedule, ?DateTimeImmutable $since, DateTimeImmutable $now, DateTimeZone $zone, int $runCount = 0): ?DateTimeImmutable
    {
        if ($schedule->paused || self::runLimit($schedule, 1, $runCount) <= 0) {
            return null;
        }

        $today = self::number(WallClock::day($now, $zone));
        $from = $since === null ? self::number($schedule->startsOn) : self::number(WallClock::day($since, $zone)) - 1;

        // only the last two days up to today can hold the latest run: today's may not be due yet, the one before is
        $latest = [];
        foreach (self::days($schedule, $from) as $day) {
            if ($day > $today) {
                break;
            }
            $latest[] = $day;
            if (count($latest) > 2) {
                array_shift($latest);
            }
        }

        foreach (array_reverse($latest) as $day) {
            $at = WallClock::at(self::text($day), $schedule->time, $zone);
            if ($at > $now) {
                continue;
            }

            return $since === null || $at > $since ? $at : null;
        }

        return null;
    }

    /** How many runs may still happen: the wanted number, capped by what is left of a schedule that ends after N runs. */
    private static function runLimit(Schedule $schedule, int $wanted, int $runCount): int
    {
        return $schedule->ends->type === 'count' ? min($wanted, ($schedule->ends->count ?? 0) - $runCount) : $wanted;
    }

    /**
     * The days (as day numbers) the schedule falls on from `from` on, ascending: not before the start day, not after
     * the end day and not after `Schedule::LAST_DAY`.
     *
     * @return Generator<int, int>
     */
    private static function days(Schedule $schedule, int $from): Generator
    {
        $lastDay = $schedule->ends->type === 'on' && $schedule->ends->date !== null && strcmp($schedule->ends->date, Schedule::LAST_DAY) < 0
            ? $schedule->ends->date
            : Schedule::LAST_DAY;
        $last = self::number($lastDay);

        foreach (self::scheduleDays($schedule, max($from, self::number($schedule->startsOn))) as $day) {
            if ($day > $last) {
                return;
            }
            yield $day;
        }
    }

    /**
     * The days the schedule falls on from `lowest` on, which is not before the start day; without end.
     *
     * @return Generator<int, int>
     */
    private static function scheduleDays(Schedule $schedule, int $lowest): Generator
    {
        $interval = max(1, $schedule->interval);
        $start = self::number($schedule->startsOn);
        [$startYear, $startMonth, $startDay] = array_map(intval(...), explode('-', $schedule->startsOn));

        switch ($schedule->frequency) {
            case Frequency::Daily:
                for ($day = $start + (int) ceil(($lowest - $start) / $interval) * $interval; ; $day += $interval) {
                    yield $day;
                }

            case Frequency::Weekly:
                $offsets = self::weekdayOffsets($schedule, $start);
                $firstMonday = $start - (self::weekday($start) + 6) % 7;
                $span = 7 * $interval;
                for ($block = intdiv($lowest - $firstMonday, $span); ; $block++) {
                    $monday = $firstMonday + $block * $span;
                    foreach ($offsets as $offset) {
                        if ($monday + $offset >= $lowest) {
                            yield $monday + $offset;
                        }
                    }
                }

            case Frequency::Monthly:
                [$lowYear, $lowMonth] = array_map(intval(...), explode('-', self::text($lowest)));
                $anchor = $startYear * 12 + $startMonth - 1;
                for ($block = intdiv($lowYear * 12 + $lowMonth - 1 - $anchor, $interval); ; $block++) {
                    $index = $anchor + $block * $interval;
                    $year = intdiv($index, 12);
                    $month = $index % 12 + 1;
                    $day = self::number(sprintf('%04d-%02d-%02d', $year, $month, self::dayOfMonth($schedule, $startDay, $year, $month)));
                    if ($day >= $lowest) {
                        yield $day;
                    }
                }

            case Frequency::Yearly:
                [$month, $dayInMonth] = $schedule->yearlyDate !== null
                    ? array_map(intval(...), explode('-', $schedule->yearlyDate))
                    : [$startMonth, $startDay];
                $lowYear = (int) substr(self::text($lowest), 0, 4);
                for ($block = intdiv($lowYear - $startYear, $interval); ; $block++) {
                    $year = $startYear + $block * $interval;
                    $day = self::number(sprintf('%04d-%02d-%02d', $year, $month, min($dayInMonth, self::daysInMonth($year, $month))));
                    if ($day >= $lowest) {
                        yield $day;
                    }
                }
        }
    }

    /**
     * The days after Monday (Monday 0 … Sunday 6) a weekly schedule falls on, in order; without weekdays the weekday
     * of the start day.
     *
     * @return list<int>
     */
    private static function weekdayOffsets(Schedule $schedule, int $start): array
    {
        $weekdays = $schedule->weekdays !== [] ? $schedule->weekdays : [self::weekday($start)];
        $offsets = array_values(array_unique(array_map(fn (int $weekday): int => ($weekday + 6) % 7, $weekdays)));
        sort($offsets);

        return $offsets;
    }

    /** The day of the month a monthly schedule falls on in a month. */
    private static function dayOfMonth(Schedule $schedule, int $startDay, int $year, int $month): int
    {
        $length = self::daysInMonth($year, $month);

        $nth = $schedule->nthWeekday;
        if ($nth !== null && $nth['n'] > 0) {
            $firstWeekday = self::weekday(self::number(sprintf('%04d-%02d-01', $year, $month)));

            return 1 + ($nth['weekday'] - $firstWeekday + 7) % 7 + 7 * ($nth['n'] - 1);
        }
        if ($nth !== null) {
            $lastWeekday = self::weekday(self::number(sprintf('%04d-%02d-%02d', $year, $month, $length)));

            return $length - ($lastWeekday - $nth['weekday'] + 7) % 7;
        }

        return match (true) {
            $schedule->monthDay === 'last' => $length,
            is_int($schedule->monthDay) => min(max(1, $schedule->monthDay), $length),
            default => min($startDay, $length),
        };
    }

    private static function daysInMonth(int $year, int $month): int
    {
        return (int) gmdate('t', (int) gmmktime(0, 0, 0, $month, 1, $year));
    }

    /** The number of a day, counted from 1970-01-01; days have no zone. */
    private static function number(string $day): int
    {
        [$year, $month, $dayOfMonth] = array_map(intval(...), explode('-', $day));

        return intdiv((int) gmmktime(0, 0, 0, $month, $dayOfMonth, $year), self::SECONDS_PER_DAY);
    }

    private static function text(int $day): string
    {
        return gmdate('Y-m-d', $day * self::SECONDS_PER_DAY);
    }

    /** 0 = Sunday … 6 = Saturday; 1970-01-01 was a Thursday. */
    private static function weekday(int $day): int
    {
        return (($day + 4) % 7 + 7) % 7;
    }
}
