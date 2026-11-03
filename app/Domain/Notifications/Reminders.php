<?php

namespace App\Domain\Notifications;

use App\Domain\WorkItems\DateRange;
use DateTimeImmutable;
use DateTimeZone;
use InvalidArgumentException;

/**
 * Reminders "due" and "overdue" (spec 4.14, A275): every day at 08:00 in the time zone of the person, as long as the
 * item is open. The job runs every hour and reminds the people for whom that hour is 08:xx (zones with half hours
 * included); today is the day of the person, not of the organisation.
 */
final class Reminders
{
    /** Whether the hour that `$nowUtc` lies in is 08:00 to 08:59 in the zone. */
    public static function isReminderHour(DateTimeImmutable $nowUtc, DateTimeZone $zone): bool
    {
        return $nowUtc->setTimezone($zone)->format('G') === '8';
    }

    /** The day it is at `$nowUtc` in the zone, `YYYY-MM-DD`. */
    public static function localDay(DateTimeImmutable $nowUtc, DateTimeZone $zone): string
    {
        return $nowUtc->setTimezone($zone)->format('Y-m-d');
    }

    /**
     * Whether an item with the due date is overdue (`true`), due today (`false`) or not yet due (`null`); days compare
     * as text.
     */
    public static function dueKind(string $dueDate, string $today): ?bool
    {
        if (! DateRange::isDay($dueDate) || ! DateRange::isDay($today)) {
            throw new InvalidArgumentException("Due dates and today are days YYYY-MM-DD, not {$dueDate} and {$today}.");
        }
        $order = strcmp($dueDate, $today);

        return $order === 0 ? false : ($order < 0 ? true : null);
    }
}
