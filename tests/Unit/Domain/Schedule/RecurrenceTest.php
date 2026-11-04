<?php

use App\Domain\Schedule\Frequency;
use App\Domain\Schedule\Recurrence;
use App\Domain\Schedule\Schedule;
use App\Domain\Schedule\ScheduleEnd;

/*
 * The cases of recurrence.test.ts of the clickdummy under the same names, in Berlin, plus the edges of the server:
 * other zones, the end of 2099 and a since in the middle of a day.
 */

$berlin = new DateTimeZone('Europe/Berlin');

/** Every day at 09:00. */
$daily09 = ['frequency' => 'daily', 'interval' => 1, 'time' => '09:00', 'starts_on' => '2026-01-01', 'ends' => ['type' => 'never'], 'paused' => false];

/** Every Monday and Thursday at 09:00. */
$weeklyMonThu09 = ['frequency' => 'weekly', 'interval' => 1, 'weekdays' => [1, 4], 'time' => '09:00', 'starts_on' => '2026-01-01', 'ends' => ['type' => 'never'], 'paused' => false];

/** The first Monday of every month at 09:00. */
$firstMonday09 = ['frequency' => 'monthly', 'interval' => 1, 'nth_weekday' => ['n' => 1, 'weekday' => 1], 'time' => '09:00', 'starts_on' => '2026-01-01', 'ends' => ['type' => 'never'], 'paused' => false];

/** On the 31st of every month at 09:00; shorter months fall back to their last day. */
$monthDay31at09 = ['frequency' => 'monthly', 'interval' => 1, 'month_day' => 31, 'time' => '09:00', 'starts_on' => '2026-01-01', 'ends' => ['type' => 'never'], 'paused' => false];

/** Every other Wednesday at 09:00, counted from the week of Wednesday 2026-10-28. */
$everyOtherWed09 = ['frequency' => 'weekly', 'interval' => 2, 'weekdays' => [3], 'time' => '09:00', 'starts_on' => '2026-10-28', 'ends' => ['type' => 'never'], 'paused' => false];

/** A schedule from a fixture with some fields changed; `null` takes a field away. */
$plan = fn (array $fixture, array $changes = []): Schedule => Schedule::parse(array_filter(array_merge($fixture, $changes), fn ($value) => $value !== null));

$at = fn (string $iso): DateTimeImmutable => new DateTimeImmutable($iso);

/** The instants as the clickdummy writes them; one that is not in UTC shows its offset and fails the comparison. */
$iso = fn (array $instants): array => array_map(
    fn (DateTimeImmutable $instant): string => $instant->getTimezone()->getName() === 'UTC' ? $instant->format('Y-m-d\TH:i:s.v\Z') : $instant->format(DATE_ATOM),
    $instants,
);

$next = fn (Schedule $schedule, string $after, int $count, int $runCount = 0, ?DateTimeZone $zone = null): array => $iso(Recurrence::next($schedule, $at($after), $count, $zone ?? $berlin, $runCount));

$catchUp = function (Schedule $schedule, ?string $since, string $now, int $runCount = 0, ?DateTimeZone $zone = null) use ($at, $iso, $berlin): ?string {
    $found = Recurrence::catchUp($schedule, $since === null ? null : $at($since), $at($now), $zone ?? $berlin, $runCount);

    return $found === null ? null : $iso([$found])[0];
};

describe('next', function () use ($plan, $next, $at, $berlin, $daily09, $weeklyMonThu09, $firstMonday09, $monthDay31at09, $everyOtherWed09) {
    describe('daily', function () use ($plan, $next, $at, $berlin, $daily09) {
        it('stays at 09:00 local time across the end of summer time (2026-10-25)', function () use ($plan, $next, $daily09) {
            expect($next($plan($daily09), '2026-10-23T08:00:00Z', 3))->toBe([
                '2026-10-24T07:00:00.000Z',
                '2026-10-25T08:00:00.000Z',
                '2026-10-26T08:00:00.000Z',
            ]);
        });

        it('stays at 09:00 local time across the start of summer time (2027-03-28)', function () use ($plan, $next, $daily09) {
            expect($next($plan($daily09), '2027-03-27T09:00:00Z', 2))->toBe([
                '2027-03-28T07:00:00.000Z',
                '2027-03-29T07:00:00.000Z',
            ]);
        });

        it('is 09:00 on the wall clock on every day around both switches', function () use ($plan, $at, $berlin, $daily09) {
            $wallClock = fn (string $after): array => array_map(
                fn (DateTimeImmutable $instant): string => $instant->setTimezone($berlin)->format('H:i'),
                Recurrence::next($plan($daily09), $at($after), 14, $berlin),
            );

            expect($wallClock('2026-10-20T00:00:00Z'))->toBe(array_fill(0, 14, '09:00'))
                ->and($wallClock('2027-03-20T00:00:00Z'))->toBe(array_fill(0, 14, '09:00'));
        });

        it('does not return the instant it starts after', function () use ($plan, $next, $daily09) {
            expect($next($plan($daily09), '2026-10-28T08:00:00Z', 1))->toBe(['2026-10-29T08:00:00.000Z']);
        });

        it('counts the interval from the start day', function () use ($plan, $next, $daily09) {
            expect($next($plan($daily09, ['interval' => 3, 'starts_on' => '2026-10-26']), '2026-10-28T09:00:00Z', 3))->toBe([
                '2026-10-29T08:00:00.000Z',
                '2026-11-01T08:00:00.000Z',
                '2026-11-04T08:00:00.000Z',
            ]);
        });

        it('waits for a start day in the future', function () use ($plan, $next, $daily09) {
            expect($next($plan($daily09, ['starts_on' => '2026-12-24']), '2026-10-28T09:00:00Z', 1))->toBe(['2026-12-24T08:00:00.000Z']);
        });

        it('moves a wall-clock time that does not exist (02:30 on 2027-03-28) forward by the gap', function () use ($plan, $next, $daily09) {
            expect($next($plan($daily09, ['time' => '02:30']), '2027-03-27T12:00:00Z', 2))->toBe([
                '2027-03-28T01:30:00.000Z', // 03:30 summer time
                '2027-03-29T00:30:00.000Z', // 02:30 summer time
            ]);
        });

        it('takes the first of a wall-clock time that happens twice (02:30 on 2026-10-25)', function () use ($plan, $next, $daily09) {
            expect($next($plan($daily09, ['time' => '02:30']), '2026-10-24T12:00:00Z', 3))->toBe([
                '2026-10-25T00:30:00.000Z', // 02:30 summer time, the first one
                '2026-10-26T01:30:00.000Z',
                '2026-10-27T01:30:00.000Z',
            ]);
        });
    });

    describe('weekly', function () use ($plan, $next, $daily09, $weeklyMonThu09, $everyOtherWed09) {
        it('repeats on the chosen weekdays', function () use ($plan, $next, $weeklyMonThu09) {
            expect($next($plan($weeklyMonThu09), '2026-10-28T09:00:00Z', 3))->toBe([
                '2026-10-29T08:00:00.000Z',
                '2026-11-02T08:00:00.000Z',
                '2026-11-05T08:00:00.000Z',
            ]);
        });

        it('counts the interval in weeks from the week of the start day', function () use ($plan, $next, $everyOtherWed09) {
            expect($next($plan($everyOtherWed09), '2026-10-28T09:00:00Z', 2))->toBe([
                '2026-11-11T08:00:00.000Z',
                '2026-11-25T08:00:00.000Z',
            ]);
        });

        it('includes the start day itself when it is still ahead', function () use ($plan, $next, $everyOtherWed09) {
            expect($next($plan($everyOtherWed09), '2026-10-28T07:00:00Z', 1))->toBe(['2026-10-28T08:00:00.000Z']);
        });

        it('skips days of the first week that lie before the start day', function () use ($plan, $next, $weeklyMonThu09) {
            // Monday 2026-10-26 is before the start day; the weeks 2 and 4 follow
            expect($next($plan($weeklyMonThu09, ['interval' => 2, 'starts_on' => '2026-10-28']), '2026-10-28T09:00:00Z', 5))->toBe([
                '2026-10-29T08:00:00.000Z',
                '2026-11-09T08:00:00.000Z',
                '2026-11-12T08:00:00.000Z',
                '2026-11-23T08:00:00.000Z',
                '2026-11-26T08:00:00.000Z',
            ]);
        });

        it('treats Sunday as the last day of the week', function () use ($plan, $next, $everyOtherWed09) {
            expect($next($plan($everyOtherWed09, ['weekdays' => [0]]), '2026-10-28T09:00:00Z', 3))->toBe([
                '2026-11-01T08:00:00.000Z',
                '2026-11-15T08:00:00.000Z',
                '2026-11-29T08:00:00.000Z',
            ]);
        });

        it('uses the weekday of the start day when no weekdays are given', function () use ($plan, $next, $daily09) {
            expect($next($plan($daily09, ['frequency' => 'weekly', 'starts_on' => '2026-10-28']), '2026-10-28T09:00:00Z', 2))->toBe([
                '2026-11-04T08:00:00.000Z',
                '2026-11-11T08:00:00.000Z',
            ]);
        });
    });

    describe('monthly', function () use ($plan, $next, $daily09, $firstMonday09, $monthDay31at09) {
        it('repeats on the n-th weekday of the month', function () use ($plan, $next, $firstMonday09) {
            expect($next($plan($firstMonday09), '2026-10-28T09:00:00Z', 5))->toBe([
                '2026-11-02T08:00:00.000Z',
                '2026-12-07T08:00:00.000Z',
                '2027-01-04T08:00:00.000Z',
                '2027-02-01T08:00:00.000Z',
                '2027-03-01T08:00:00.000Z',
            ]);
        });

        it('falls back to the last day of a month that is too short for the day of the month', function () use ($plan, $next, $monthDay31at09) {
            expect($next($plan($monthDay31at09), '2026-10-28T09:00:00Z', 3))->toBe([
                '2026-10-31T08:00:00.000Z',
                '2026-11-30T08:00:00.000Z',
                '2026-12-31T08:00:00.000Z',
            ]);
        });

        it('shortens the 31st to the 28th in February and moves on to summer time in March', function () use ($plan, $next, $monthDay31at09) {
            expect($next($plan($monthDay31at09), '2027-01-31T12:00:00Z', 2))->toBe([
                '2027-02-28T08:00:00.000Z',
                '2027-03-31T07:00:00.000Z',
            ]);
        });

        it('runs on 30 April and on 29 February in a leap year', function () use ($plan, $next, $monthDay31at09) {
            expect($next($plan($monthDay31at09), '2027-04-01T00:00:00Z', 1))->toBe(['2027-04-30T07:00:00.000Z'])
                ->and($next($plan($monthDay31at09), '2028-02-01T00:00:00Z', 1))->toBe(['2028-02-29T08:00:00.000Z']);
        });

        it('supports "last" as the day of the month', function () use ($plan, $next, $monthDay31at09) {
            expect($next($plan($monthDay31at09, ['month_day' => 'last']), '2027-01-31T12:00:00Z', 2))->toBe([
                '2027-02-28T08:00:00.000Z',
                '2027-03-31T07:00:00.000Z',
            ]);
        });

        it('supports the last weekday of the month with n = -1', function () use ($plan, $next, $firstMonday09) {
            expect($next($plan($firstMonday09, ['nth_weekday' => ['n' => -1, 'weekday' => 5], 'time' => '17:30']), '2026-10-28T09:00:00Z', 3))->toBe([
                '2026-10-30T16:30:00.000Z',
                '2026-11-27T16:30:00.000Z',
                '2026-12-25T16:30:00.000Z',
            ]);
        });

        it('counts the interval in months from the month of the start day', function () use ($plan, $next, $firstMonday09) {
            expect($next($plan($firstMonday09, ['interval' => 3, 'starts_on' => '2026-10-01']), '2026-10-28T09:00:00Z', 3))->toBe([
                '2027-01-04T08:00:00.000Z',
                '2027-04-05T07:00:00.000Z',
                '2027-07-05T07:00:00.000Z',
            ]);
        });

        it('prefers the n-th weekday when both rules are set', function () use ($next) {
            // parse drops the day of the month next to an n-th weekday; a schedule built by hand may still carry both
            $both = new Schedule(
                frequency: Frequency::Monthly,
                interval: 1,
                weekdays: [],
                monthDay: 15,
                nthWeekday: ['n' => 1, 'weekday' => 1],
                yearlyDate: null,
                time: '09:00',
                startsOn: '2026-01-01',
                ends: new ScheduleEnd('never'),
                paused: false,
            );

            expect($next($both, '2026-10-28T09:00:00Z', 1))->toBe(['2026-11-02T08:00:00.000Z']);
        });

        it('uses the day of the start day when no day is given', function () use ($plan, $next, $daily09) {
            expect($next($plan($daily09, ['frequency' => 'monthly', 'starts_on' => '2026-10-15']), '2026-10-28T09:00:00Z', 2))->toBe([
                '2026-11-15T08:00:00.000Z',
                '2026-12-15T08:00:00.000Z',
            ]);
        });
    });

    describe('yearly', function () use ($plan, $next, $daily09) {
        $march15 = [...$daily09, 'frequency' => 'yearly', 'yearly_date' => '03-15', 'time' => '08:00'];

        it('repeats on the date every year', function () use ($plan, $next, $march15) {
            expect($next($plan($march15), '2026-10-28T09:00:00Z', 3))->toBe([
                '2027-03-15T07:00:00.000Z',
                '2028-03-15T07:00:00.000Z',
                '2029-03-15T07:00:00.000Z',
            ]);
        });

        it('moves February 29 to the 28th in years without a leap day', function () use ($plan, $next, $march15) {
            expect($next($plan($march15, ['yearly_date' => '02-29', 'time' => '12:00']), '2026-10-28T09:00:00Z', 3))->toBe([
                '2027-02-28T11:00:00.000Z',
                '2028-02-29T11:00:00.000Z',
                '2029-02-28T11:00:00.000Z',
            ]);
        });

        it('counts the interval in years', function () use ($plan, $next, $march15) {
            expect($next($plan($march15, ['interval' => 2, 'starts_on' => '2026-01-01']), '2026-10-28T09:00:00Z', 2))->toBe([
                '2028-03-15T07:00:00.000Z',
                '2030-03-15T07:00:00.000Z',
            ]);
        });

        it('uses the date of the start day when no date is given', function () use ($plan, $next, $march15) {
            expect($next($plan($march15, ['yearly_date' => null, 'starts_on' => '2026-11-20']), '2026-10-28T09:00:00Z', 2))->toBe([
                '2026-11-20T07:00:00.000Z',
                '2027-11-20T07:00:00.000Z',
            ]);
        });
    });

    describe('end and pause', function () use ($plan, $next, $daily09) {
        it('stops after the number of runs when the schedule ends after N runs', function () use ($plan, $next, $daily09) {
            expect($next($plan($daily09, ['ends' => ['type' => 'count', 'count' => 3]]), '2026-10-28T09:00:00Z', 5, 2))->toHaveCount(1);
        });

        it('counts from zero runs when the run count is not given', function () use ($plan, $next, $daily09) {
            expect($next($plan($daily09, ['ends' => ['type' => 'count', 'count' => 3]]), '2026-10-28T09:00:00Z', 5))->toHaveCount(3);
        });

        it('returns nothing once all runs are done', function () use ($plan, $next, $daily09) {
            expect($next($plan($daily09, ['ends' => ['type' => 'count', 'count' => 3]]), '2026-10-28T09:00:00Z', 5, 3))->toBe([]);
        });

        it('includes the last day when the schedule ends on a date', function () use ($plan, $next, $daily09) {
            expect($next($plan($daily09, ['ends' => ['type' => 'on', 'date' => '2026-10-30']]), '2026-10-28T09:00:00Z', 5))->toBe([
                '2026-10-29T08:00:00.000Z',
                '2026-10-30T08:00:00.000Z',
            ]);
        });

        it('returns nothing for a paused schedule', function () use ($plan, $next, $daily09) {
            expect($next($plan($daily09, ['paused' => true]), '2026-10-28T09:00:00Z', 5))->toBe([]);
        });

        it('gives no run after 2099-12-31', function () use ($plan, $next, $daily09) {
            expect($next($plan($daily09, ['starts_on' => '2099-12-30']), '2099-01-01T00:00:00Z', 5))->toBe([
                '2099-12-30T08:00:00.000Z',
                '2099-12-31T08:00:00.000Z',
            ])
                // every 999 years: the first run in 2026 is the only one before 2100
                ->and($next($plan($daily09, ['frequency' => 'yearly', 'interval' => 999, 'starts_on' => '2026-12-01']), '2026-10-28T09:00:00Z', 5))->toBe(['2026-12-01T08:00:00.000Z'])
                ->and($next($plan($daily09, ['interval' => 999, 'starts_on' => '2099-06-01']), '2099-06-02T09:00:00Z', 5))->toBe([])
                ->and($next($plan($daily09, ['frequency' => 'monthly', 'interval' => 999]), '2026-01-02T09:00:00Z', 5))->toBe([]);
        });
    });

    describe('bad input', function () use ($plan, $next, $daily09) {
        it('returns nothing for a schedule it cannot read', function () use ($daily09) {
            // the server never holds such a schedule: reading it gives none, so there is nothing to count
            expect(Schedule::read([...$daily09, 'starts_on' => '']))->toBeNull()
                ->and(Schedule::read([...$daily09, 'starts_on' => '2026-02-30']))->toBeNull()
                ->and(Schedule::read([...$daily09, 'time' => '25:99']))->toBeNull()
                ->and(Schedule::read([...$daily09, 'ends' => ['type' => 'on', 'date' => 'soon']]))->toBeNull();
        });

        it('returns nothing for a count of zero or an invalid instant', function () use ($plan, $next, $daily09) {
            // an instant is always valid in PHP; a count below zero is the other edge
            expect($next($plan($daily09), '2026-10-28T09:00:00Z', 0))->toBe([])
                ->and($next($plan($daily09), '2026-10-28T09:00:00Z', -2))->toBe([]);
        });

        it('treats an interval below one as one and does not loop forever on a weekly schedule without valid weekdays', function () use ($next) {
            $odd = new Schedule(
                frequency: Frequency::Weekly,
                interval: 0,
                weekdays: [],
                monthDay: null,
                nthWeekday: null,
                yearlyDate: null,
                time: '09:00',
                startsOn: '2026-01-01',
                ends: new ScheduleEnd('never'),
                paused: false,
            );

            expect($next($odd, '2026-10-28T09:00:00Z', 2))->toBe([
                '2026-10-29T08:00:00.000Z',
                '2026-11-05T08:00:00.000Z',
            ]);
        });

        it('rejects an unknown time zone', function () {
            // the rules take a DateTimeZone: an unknown name never reaches them
            expect(fn () => new DateTimeZone('Mars/Phobos'))->toThrow(Exception::class);
        });
    });

    it('returns strictly increasing, unique instants', function () use ($plan, $at, $berlin, $weeklyMonThu09) {
        $instants = Recurrence::next($plan($weeklyMonThu09), $at('2026-10-20T00:00:00Z'), 40, $berlin);

        expect($instants)->toHaveCount(40);
        for ($i = 1; $i < count($instants); $i++) {
            expect($instants[$i] > $instants[$i - 1])->toBeTrue();
        }
    });

    it('gives the five runs of Monatsbericht after 2026-10-28 10:00 Berlin', function () use ($plan, $next, $firstMonday09) {
        $runs = array_map(
            fn (string $instant): string => (new DateTimeImmutable($instant))->setTimezone(new DateTimeZone('Europe/Berlin'))->format('Y-m-d H:i'),
            $next($plan($firstMonday09), '2026-10-28T09:00:00Z', 5),
        );

        expect($runs)->toBe(['2026-11-02 09:00', '2026-12-07 09:00', '2027-01-04 09:00', '2027-02-01 09:00', '2027-03-01 09:00']);
    });

    it('counts in New York and in Kolkata', function () use ($plan, $next, $daily09) {
        // New York leaves summer time on 2026-11-01: 09:00 is 13:00 UTC before, 14:00 UTC after
        expect($next($plan($daily09), '2026-10-30T14:00:00Z', 3, 0, new DateTimeZone('America/New_York')))->toBe([
            '2026-10-31T13:00:00.000Z',
            '2026-11-01T14:00:00.000Z',
            '2026-11-02T14:00:00.000Z',
        ])
            // Kolkata is UTC+05:30 all year: 09:00 is 03:30 UTC, and 08:00 UTC is already the afternoon of that day
            ->and($next($plan($daily09), '2026-10-28T08:00:00Z', 2, 0, new DateTimeZone('Asia/Kolkata')))->toBe([
                '2026-10-29T03:30:00.000Z',
                '2026-10-30T03:30:00.000Z',
            ]);
    });
});

describe('catchUp', function () use ($plan, $catchUp, $daily09, $firstMonday09) {
    it('catches up the latest missed run only', function () use ($plan, $catchUp, $daily09) {
        expect($catchUp($plan($daily09), '2026-10-25T08:00:00Z', '2026-10-28T09:00:00Z'))->toBe('2026-10-28T08:00:00.000Z');
    });

    it('finds nothing when the last run is the latest scheduled one', function () use ($plan, $catchUp, $daily09) {
        expect($catchUp($plan($daily09), '2026-10-28T08:00:00Z', '2026-10-28T09:00:00Z'))->toBeNull();
    });

    it('does not run ahead of time: a run that is due later today is not missed yet', function () use ($plan, $catchUp, $daily09) {
        // 07:00 local time, two hours before the run
        expect($catchUp($plan($daily09), '2026-10-25T08:00:00Z', '2026-10-28T06:00:00Z'))->toBe('2026-10-27T08:00:00.000Z');
    });

    it('works across the end of summer time', function () use ($plan, $catchUp, $daily09) {
        expect($catchUp($plan($daily09), '2026-10-24T07:00:00Z', '2026-10-25T09:00:00Z'))->toBe('2026-10-25T08:00:00.000Z');
    });

    it('catches up a monthly schedule once, even when two runs were missed', function () use ($plan, $catchUp, $firstMonday09) {
        // 2026-09-07 was the last run; 2026-10-05 and 2026-11-02 are missed
        expect($catchUp($plan($firstMonday09), '2026-09-07T07:00:00Z', '2026-11-03T10:00:00Z'))->toBe('2026-11-02T08:00:00.000Z');
    });

    it('catches up the latest run since the start day when the schedule never ran', function () use ($plan, $catchUp, $daily09) {
        expect($catchUp($plan($daily09), null, '2026-10-28T09:00:00Z'))->toBe('2026-10-28T08:00:00.000Z');
    });

    it('finds nothing before the start day', function () use ($plan, $catchUp, $daily09) {
        expect($catchUp($plan($daily09, ['starts_on' => '2026-12-01']), null, '2026-10-28T09:00:00Z'))->toBeNull();
    });

    it('does not go past the end date', function () use ($plan, $catchUp, $daily09) {
        expect($catchUp($plan($daily09, ['ends' => ['type' => 'on', 'date' => '2026-10-26']]), '2026-10-24T08:00:00Z', '2026-10-28T09:00:00Z'))->toBe('2026-10-26T08:00:00.000Z');
    });

    it('finds nothing for a paused schedule', function () use ($plan, $catchUp, $daily09) {
        expect($catchUp($plan($daily09, ['paused' => true]), '2026-10-25T08:00:00Z', '2026-10-28T09:00:00Z'))->toBeNull();
    });

    it('finds nothing once the schedule has run its last run', function () use ($plan, $catchUp, $daily09) {
        $threeRuns = $plan($daily09, ['ends' => ['type' => 'count', 'count' => 3]]);

        expect($catchUp($threeRuns, '2026-10-25T08:00:00Z', '2026-10-28T09:00:00Z', 3))->toBeNull()
            ->and($catchUp($threeRuns, '2026-10-25T08:00:00Z', '2026-10-28T09:00:00Z', 2))->not->toBeNull();
    });

    it('finds nothing for a schedule it cannot read', function () use ($daily09) {
        expect(Schedule::read([...$daily09, 'time' => 'late']))->toBeNull();
    });

    it('never returns an instant before since', function () use ($plan, $catchUp, $daily09, $firstMonday09) {
        // saved at 09:30 Berlin, after today's run at 09:00: neither today's nor yesterday's run is caught up
        expect($catchUp($plan($daily09), '2026-10-28T08:30:00Z', '2026-10-28T20:00:00Z'))->toBeNull()
            // saved on the Wednesday after the first Monday: that Monday is not caught up, nor any before it
            ->and($catchUp($plan($firstMonday09), '2026-11-04T10:00:00Z', '2026-11-30T10:00:00Z'))->toBeNull()
            // the next day's run comes after since and is caught up
            ->and($catchUp($plan($daily09), '2026-10-28T08:30:00Z', '2026-10-29T09:00:00Z'))->toBe('2026-10-29T08:00:00.000Z');
    });

    it('counts in the zone it is given', function () use ($plan, $catchUp, $daily09) {
        // 13:00 UTC is 09:00 in New York (summer time) and 18:30 in Kolkata
        $newYork = new DateTimeZone('America/New_York');
        $kolkata = new DateTimeZone('Asia/Kolkata');

        expect($catchUp($plan($daily09), null, '2026-10-28T12:59:00Z', 0, $newYork))->toBe('2026-10-27T13:00:00.000Z')
            ->and($catchUp($plan($daily09), null, '2026-10-28T13:00:00Z', 0, $newYork))->toBe('2026-10-28T13:00:00.000Z')
            ->and($catchUp($plan($daily09), null, '2026-10-28T13:00:00Z', 0, $kolkata))->toBe('2026-10-28T03:30:00.000Z');
    });

    it('catches up no run after 2099', function () use ($plan, $catchUp, $daily09) {
        expect($catchUp($plan($daily09, ['starts_on' => '2099-12-30']), null, '2100-01-05T12:00:00Z'))->toBe('2099-12-31T08:00:00.000Z');
    });
});
