<?php

namespace App\Domain\Automations;

use DateTimeImmutable;
use DateTimeZone;

/**
 * When the nightly automations run: in the hour from 03:00 to 03:59 in the time zone of the organisation. The job
 * runs every hour; on the days the clocks change, the hour exists once, so the night runs once.
 */
final class NightlyRun
{
    public const HOUR = 3;

    /** Whether the hour that `$hourUtc` lies in is 03:xx in the zone. */
    public static function isDue(DateTimeImmutable $hourUtc, DateTimeZone $zone): bool
    {
        return (int) $hourUtc->setTimezone($zone)->format('G') === self::HOUR;
    }
}
