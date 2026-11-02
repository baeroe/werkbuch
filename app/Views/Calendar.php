<?php

namespace App\Views;

use App\Domain\Time\OrgCalendar;
use App\Models\Organization;
use DateTimeZone;

/**
 * The calendar of the organisation as it is now: its time zone, its first day of the week and the clock of the app
 * (`now()`, so tests travel with `travelTo`).
 */
final class Calendar
{
    public static function current(): OrgCalendar
    {
        $organization = Organization::current();

        return new OrgCalendar(new DateTimeZone($organization->timezone), $organization->week_start, now()->toDateTimeImmutable());
    }
}
