<?php

use App\Domain\Filter\InvalidInput;
use App\Domain\Schedule\Frequency;
use App\Domain\Schedule\Schedule;
use App\Domain\Schedule\ScheduleEnd;

/** Monatsbericht: the first Monday of every month at 09:00. */
$monthly = ['frequency' => 'monthly', 'interval' => 1, 'nth_weekday' => ['n' => 1, 'weekday' => 1], 'time' => '09:00', 'starts_on' => '2026-10-01', 'ends' => ['type' => 'never'], 'paused' => false];

/** The paths and codes `parse` refuses the input with, `[]` when it takes it. */
$refusal = function (mixed $raw): array {
    try {
        Schedule::parse($raw);
    } catch (InvalidInput $refused) {
        return $refused->errors;
    }

    return [];
};

it('parses a schedule of every frequency into its normal form', function () use ($monthly) {
    $schedule = Schedule::parse($monthly);

    expect($schedule->frequency)->toBe(Frequency::Monthly)
        ->and($schedule->interval)->toBe(1)
        ->and($schedule->weekdays)->toBe([])
        ->and($schedule->monthDay)->toBeNull()
        ->and($schedule->nthWeekday)->toBe(['n' => 1, 'weekday' => 1])
        ->and($schedule->yearlyDate)->toBeNull()
        ->and($schedule->time)->toBe('09:00')
        ->and($schedule->startsOn)->toBe('2026-10-01')
        ->and($schedule->ends)->toEqual(new ScheduleEnd('never'))
        ->and($schedule->paused)->toBeFalse()
        ->and($schedule->toArray())->toBe($monthly)
        ->and(Schedule::parse([...$monthly, 'frequency' => 'daily', 'nth_weekday' => null, 'interval' => 2])->toArray())
        ->toBe(['frequency' => 'daily', 'interval' => 2, 'time' => '09:00', 'starts_on' => '2026-10-01', 'ends' => ['type' => 'never'], 'paused' => false])
        ->and(Schedule::parse([...$monthly, 'frequency' => 'weekly', 'weekdays' => [4, 1, 4, 0]])->toArray())
        ->toBe(['frequency' => 'weekly', 'interval' => 1, 'weekdays' => [0, 1, 4], 'time' => '09:00', 'starts_on' => '2026-10-01', 'ends' => ['type' => 'never'], 'paused' => false])
        ->and(Schedule::parse([...$monthly, 'nth_weekday' => null, 'month_day' => 'last'])->toArray())
        ->toBe(['frequency' => 'monthly', 'interval' => 1, 'month_day' => 'last', 'time' => '09:00', 'starts_on' => '2026-10-01', 'ends' => ['type' => 'never'], 'paused' => false])
        ->and(Schedule::parse([...$monthly, 'frequency' => 'yearly', 'yearly_date' => '02-29', 'ends' => ['type' => 'count', 'count' => 3], 'paused' => true])->toArray())
        ->toBe(['frequency' => 'yearly', 'interval' => 1, 'yearly_date' => '02-29', 'time' => '09:00', 'starts_on' => '2026-10-01', 'ends' => ['type' => 'count', 'count' => 3], 'paused' => true]);
});

it('reads its own normal form back as it parsed it', function () use ($monthly) {
    $schedules = [
        $monthly,
        [...$monthly, 'frequency' => 'daily', 'interval' => 3],
        [...$monthly, 'frequency' => 'weekly', 'weekdays' => [3, 5], 'interval' => 2],
        [...$monthly, 'frequency' => 'weekly', 'weekdays' => []],
        [...$monthly, 'nth_weekday' => ['n' => -1, 'weekday' => 0]],
        [...$monthly, 'nth_weekday' => null, 'month_day' => 31],
        [...$monthly, 'nth_weekday' => null],
        [...$monthly, 'frequency' => 'yearly', 'yearly_date' => '12-24'],
        [...$monthly, 'frequency' => 'yearly'],
        [...$monthly, 'ends' => ['type' => 'on', 'date' => '2027-06-30']],
        [...$monthly, 'ends' => ['type' => 'count', 'count' => 12], 'paused' => true],
    ];

    foreach ($schedules as $raw) {
        $parsed = Schedule::parse($raw);

        expect(Schedule::parse($parsed->toArray()))->toEqual($parsed)
            ->and(Schedule::read($parsed->toArray()))->toEqual($parsed);
    }
});

it('drops the fields its frequency does not use', function () use ($monthly) {
    // a daily schedule ignores weekdays, days and dates, even ones it could not read
    $daily = Schedule::parse([...$monthly, 'frequency' => 'daily', 'weekdays' => 'monday', 'month_day' => 99, 'nth_weekday' => 'first', 'yearly_date' => '99-99']);

    expect($daily->weekdays)->toBe([])
        ->and($daily->monthDay)->toBeNull()
        ->and($daily->nthWeekday)->toBeNull()
        ->and($daily->yearlyDate)->toBeNull()
        ->and($daily->toArray())->not->toHaveKeys(['weekdays', 'month_day', 'nth_weekday', 'yearly_date'])
        // the n-th weekday wins: the day of the month next to it is not read
        ->and(Schedule::parse([...$monthly, 'month_day' => 'first'])->monthDay)->toBeNull()
        // a schedule that ends never keeps no date, and one that ends on a date no count
        ->and(Schedule::parse([...$monthly, 'ends' => ['type' => 'never', 'date' => 'soon', 'count' => 'x']])->ends)->toEqual(new ScheduleEnd('never'))
        ->and(Schedule::parse([...$monthly, 'ends' => ['type' => 'on', 'date' => '2027-01-01', 'count' => 0]])->ends)->toEqual(new ScheduleEnd('on', '2027-01-01'))
        ->and(Schedule::parse([...$monthly, 'ends' => ['type' => 'count', 'count' => 2, 'date' => null]])->ends)->toEqual(new ScheduleEnd('count', count: 2));
});

it('is not paused when it does not say so', function () use ($monthly) {
    $raw = $monthly;
    unset($raw['paused']);

    expect(Schedule::parse($raw)->paused)->toBeFalse();
});

it('refuses anything but an object of known keys at the root', function () use ($refusal, $monthly) {
    expect($refusal(null))->toBe(['' => 'shape'])
        ->and($refusal('weekly'))->toBe(['' => 'shape'])
        ->and($refusal([1, 2]))->toBe(['' => 'shape'])
        ->and($refusal([...$monthly, 'timezone' => 'Europe/Berlin']))->toBe(['' => 'shape']);
});

it('refuses a frequency it does not know', function () use ($refusal, $monthly) {
    $raw = $monthly;
    unset($raw['frequency']);

    expect($refusal([...$monthly, 'frequency' => 'hourly']))->toBe(['frequency' => 'frequency'])
        ->and($refusal([...$monthly, 'frequency' => 2]))->toBe(['frequency' => 'frequency'])
        ->and($refusal($raw))->toBe(['frequency' => 'frequency']);
});

it('refuses an interval that is no whole number from 1 to 999', function () use ($refusal, $monthly) {
    foreach ([0, -1, 1000, '2', 1.5, null] as $interval) {
        expect($refusal([...$monthly, 'interval' => $interval]))->toBe(['interval' => 'interval']);
    }

    expect($refusal([...$monthly, 'interval' => Schedule::MAX_INTERVAL]))->toBe([]);
});

it('refuses weekdays that are not days 0 to 6', function () use ($refusal, $monthly) {
    $weekly = [...$monthly, 'frequency' => 'weekly'];

    foreach ([[7], [-1], 'monday', [1, '2'], ['a' => 1], [1.0]] as $weekdays) {
        expect($refusal([...$weekly, 'weekdays' => $weekdays]))->toBe(['weekdays' => 'weekdays']);
    }

    expect($refusal([...$weekly, 'weekdays' => [0, 6]]))->toBe([]);
});

it('refuses a day of the month that is not 1 to 31 or last', function () use ($refusal, $monthly) {
    $byDay = [...$monthly, 'nth_weekday' => null];

    foreach ([0, 32, 'first', '15', 1.5] as $day) {
        expect($refusal([...$byDay, 'month_day' => $day]))->toBe(['month_day' => 'month_day']);
    }

    expect($refusal([...$byDay, 'month_day' => 1]))->toBe([]);
});

it('refuses an n-th weekday it cannot read', function () use ($refusal, $monthly) {
    foreach ([['n' => 5, 'weekday' => 1], ['n' => 0, 'weekday' => 1], ['n' => -2, 'weekday' => 1], ['n' => 1, 'weekday' => 7], ['n' => 1], ['n' => 1, 'weekday' => 1, 'week' => 2], 'first', [1, 1], ['n' => '1', 'weekday' => 1]] as $nth) {
        expect($refusal([...$monthly, 'nth_weekday' => $nth]))->toBe(['nth_weekday' => 'nth_weekday']);
    }
});

it('refuses a yearly date that no year has', function () use ($refusal, $monthly) {
    $yearly = [...$monthly, 'frequency' => 'yearly'];

    foreach (['02-30', '04-31', '13-01', '00-10', '1-1', '01-01 ', 101] as $date) {
        expect($refusal([...$yearly, 'yearly_date' => $date]))->toBe(['yearly_date' => 'yearly_date']);
    }

    expect($refusal([...$yearly, 'yearly_date' => '02-29']))->toBe([]);
});

it('refuses a time that is not HH:MM', function () use ($refusal, $monthly) {
    foreach (['24:00', '9:00', '09:60', "09:00\n", '09:00:00', 900, null] as $time) {
        expect($refusal([...$monthly, 'time' => $time]))->toBe(['time' => 'time']);
    }

    expect($refusal([...$monthly, 'time' => '23:59']))->toBe([])
        ->and($refusal([...$monthly, 'time' => '00:00']))->toBe([]);
});

it('refuses a start that is no day', function () use ($refusal, $monthly) {
    foreach (['2026-02-30', '', '2026-1-1', 20261001, null] as $day) {
        expect($refusal([...$monthly, 'starts_on' => $day]))->toBe(['starts_on' => 'starts_on']);
    }
});

it('refuses a start after 2099', function () use ($refusal, $monthly) {
    expect($refusal([...$monthly, 'starts_on' => '2100-01-01']))->toBe(['starts_on' => 'range'])
        ->and($refusal([...$monthly, 'starts_on' => '1999-12-31']))->toBe(['starts_on' => 'range'])
        ->and($refusal([...$monthly, 'starts_on' => '2099-12-31']))->toBe([])
        ->and($refusal([...$monthly, 'starts_on' => '2000-01-01']))->toBe([]);
});

it('refuses an end it cannot read', function () use ($refusal, $monthly) {
    $ends = [
        'never',
        null,
        ['type' => 'later'],
        ['type' => 'on'],
        ['type' => 'on', 'date' => '2027-02-30'],
        ['type' => 'on', 'date' => '2026-09-30'],
        ['type' => 'count', 'count' => 0],
        ['type' => 'count', 'count' => 10000],
        ['type' => 'count', 'count' => '3'],
        ['type' => 'never', 'until' => 'forever'],
    ];

    foreach ($ends as $end) {
        expect($refusal([...$monthly, 'ends' => $end]))->toBe(['ends' => 'ends']);
    }

    expect($refusal([...$monthly, 'ends' => ['type' => 'on', 'date' => '2026-10-01']]))->toBe([])
        ->and($refusal([...$monthly, 'ends' => ['type' => 'count', 'count' => Schedule::MAX_COUNT]]))->toBe([]);
});

it('refuses an end after 2099', function () use ($refusal, $monthly) {
    expect($refusal([...$monthly, 'ends' => ['type' => 'on', 'date' => '2100-01-01']]))->toBe(['ends' => 'range'])
        // without a start it can compare with, an end before 2000 is out of range too
        ->and($refusal([...$monthly, 'starts_on' => 'soon', 'ends' => ['type' => 'on', 'date' => '1999-12-31']]))->toBe(['starts_on' => 'starts_on', 'ends' => 'range'])
        ->and($refusal([...$monthly, 'starts_on' => 'soon', 'ends' => ['type' => 'on', 'date' => '2027-01-01']]))->toBe(['starts_on' => 'starts_on']);
});

it('refuses a pause that is no switch', function () use ($refusal, $monthly) {
    expect($refusal([...$monthly, 'paused' => 'yes']))->toBe(['paused' => 'shape'])
        ->and($refusal([...$monthly, 'paused' => 0]))->toBe(['paused' => 'shape']);
});

it('names every field that is wrong at once', function () use ($refusal) {
    expect($refusal(['frequency' => 'weekly', 'interval' => 0, 'weekdays' => [9], 'time' => '25:00', 'starts_on' => '2026-13-01', 'ends' => ['type' => 'x'], 'paused' => 'no']))->toBe([
        'interval' => 'interval',
        'weekdays' => 'weekdays',
        'time' => 'time',
        'starts_on' => 'starts_on',
        'ends' => 'ends',
        'paused' => 'shape',
    ]);
});

it('reads a stored schedule and gives null for a broken row', function () use ($monthly) {
    expect(Schedule::read($monthly))->toEqual(Schedule::parse($monthly))
        // a key the schema does not know (any more) does not break a stored schedule
        ->and(Schedule::read([...$monthly, 'timezone' => 'Europe/Berlin']))->toEqual(Schedule::parse($monthly))
        ->and(Schedule::read([...$monthly, 'interval' => 0]))->toBeNull()
        ->and(Schedule::read(['frequency' => 'weekly']))->toBeNull()
        ->and(Schedule::read([]))->toBeNull()
        ->and(Schedule::read([1, 2, 3]))->toBeNull();
});
