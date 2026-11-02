<?php

namespace App\Domain\Time;

use App\Domain\WorkItems\DateRange;
use DateTimeImmutable;
use DateTimeZone;
use InvalidArgumentException;

/**
 * The calendar of the organisation (master plan, contract "Uhr"): today, weeks, months and where a day begins, all in
 * the time zone of the organisation and with its first day of the week. Days are `YYYY-MM-DD` texts; they have no
 * zone, so moving by days never meets a change of the clocks.
 */
final readonly class OrgCalendar
{
    /**
     * @param  int  $weekStart  the first day of the week, 0 = Sunday, 1 = Monday … 6 = Saturday
     */
    public function __construct(
        public DateTimeZone $zone,
        public int $weekStart,
        public DateTimeImmutable $now,
    ) {
        if ($weekStart < 0 || $weekStart > 6) {
            throw new InvalidArgumentException("A week starts on day 0 to 6, not {$weekStart}.");
        }
    }

    /** The day it is now for the organisation. */
    public function today(): string
    {
        return $this->dayOf($this->now);
    }

    public function addDays(string $day, int $days): string
    {
        return self::day($day)->modify("{$days} days")->format('Y-m-d');
    }

    /** The first day of the week the day lies in. */
    public function startOfWeek(string $day): string
    {
        $weekday = (int) self::day($day)->format('w');

        return $this->addDays($day, -(($weekday - $this->weekStart + 7) % 7));
    }

    public function startOfMonth(string $day): string
    {
        return self::day($day)->format('Y-m-01');
    }

    public function endOfMonth(string $day): string
    {
        return self::day($day)->format('Y-m-t');
    }

    /**
     * The instant the day begins for the organisation, in UTC: its midnight, or the first hour after a midnight the
     * clocks skip.
     */
    public function dayStart(string $day): DateTimeImmutable
    {
        return (new DateTimeImmutable(self::day($day)->format('Y-m-d 00:00:00'), $this->zone))->setTimezone(new DateTimeZone('UTC'));
    }

    /** The day an instant falls on for the organisation. */
    public function dayOf(DateTimeImmutable $instant): string
    {
        return $instant->setTimezone($this->zone)->format('Y-m-d');
    }

    /** The day at midnight without a zone (UTC); refuses a text that is no day of the calendar. */
    private static function day(string $day): DateTimeImmutable
    {
        $parsed = DateRange::isDay($day) ? DateTimeImmutable::createFromFormat('!Y-m-d', $day, new DateTimeZone('UTC')) : false;
        if ($parsed === false) {
            throw new InvalidArgumentException("\"{$day}\" is no day of the calendar.");
        }

        return $parsed;
    }
}
