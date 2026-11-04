<?php

namespace App\Support;

use App\Domain\Schedule\Recurrence;
use App\Domain\Schedule\Schedule;
use DateTimeImmutable;
use DateTimeZone;

/**
 * When the scheduler next looks at a template, and the names of the months its title may name (spec 4.12). The zone is
 * always the one of the organisation, handed in by the caller (K3: the row it locked, not a copy read before).
 */
final class TemplateSchedule
{
    /**
     * The value of `next_run_at`: the latest missed term after `since` when one is due (at or before `now`, A339: the
     * one term to catch up), otherwise the first term after `now`; null without a schedule, for a paused one and for
     * one whose runs are used up or that has no term left. `since` is max(`last_run_at`, `schedule_from`); without it
     * the schedule counts from its start day. Instants in UTC.
     */
    public static function nextRunAt(?Schedule $schedule, ?DateTimeImmutable $since, int $runCount, DateTimeImmutable $now, DateTimeZone $zone): ?DateTimeImmutable
    {
        if ($schedule === null) {
            return null;
        }

        return Recurrence::catchUp($schedule, $since, $now, $zone, $runCount)
            ?? Recurrence::next($schedule, $since !== null && $since > $now ? $since : $now, 1, $zone, $runCount)[0]
            ?? null;
    }

    /**
     * The names of the months in the language (1 = January … 12), for `{month_name}` of a title.
     *
     * @return array<int, string>
     */
    public static function monthNames(string $locale): array
    {
        return [
            1 => __('schedule.month.january', [], $locale),
            2 => __('schedule.month.february', [], $locale),
            3 => __('schedule.month.march', [], $locale),
            4 => __('schedule.month.april', [], $locale),
            5 => __('schedule.month.may', [], $locale),
            6 => __('schedule.month.june', [], $locale),
            7 => __('schedule.month.july', [], $locale),
            8 => __('schedule.month.august', [], $locale),
            9 => __('schedule.month.september', [], $locale),
            10 => __('schedule.month.october', [], $locale),
            11 => __('schedule.month.november', [], $locale),
            12 => __('schedule.month.december', [], $locale),
        ];
    }
}
