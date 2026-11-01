<?php

use App\Domain\Filter\DayRange;
use App\Domain\Filter\Operands;
use App\Domain\Filter\Scalar;
use App\Domain\Time\OrgCalendar;

$me = '01jbz8v6w2k7c0m9x4r5t3n8qa';

/** Today is Wednesday, 2026-10-28, in Berlin (10:00 local time). */
$calendar = fn (int $weekStart = 1): OrgCalendar => new OrgCalendar(new DateTimeZone('Europe/Berlin'), $weekStart, new DateTimeImmutable('2026-10-28T09:00:00Z'));

it('turns a dynamic value into what a condition compares against', function (mixed $value, int $weekStart, mixed $expected) use ($me, $calendar) {
    expect(Operands::one($value, $me, $calendar($weekStart)))->toEqual($expected);
})->with([
    'today' => ['today', 1, new DayRange('2026-10-28', '2026-10-28')],
    'this week from monday' => ['this_week', 1, new DayRange('2026-10-26', '2026-11-01')],
    'this week from sunday' => ['this_week', 0, new DayRange('2026-10-25', '2026-10-31')],
    'this month' => ['this_month', 1, new DayRange('2026-10-01', '2026-10-31')],
    'two weeks ago' => [['relative' => '-2w'], 1, new DayRange('2026-10-14', '2026-10-14')],
    'in a week' => [['relative' => '+7d'], 1, new DayRange('2026-11-04', '2026-11-04')],
    'in three days without a sign' => [['relative' => '3d'], 1, new DayRange('2026-10-31', '2026-10-31')],
    'zero days is today' => [['relative' => '0d'], 1, new DayRange('2026-10-28', '2026-10-28')],
    'a day' => ['2026-10-31', 1, new DayRange('2026-10-31', '2026-10-31')],
    'me' => ['me', 1, new Scalar('01jbz8v6w2k7c0m9x4r5t3n8qa')],
    'a number' => [3.5, 1, new Scalar(3.5)],
    'a whole number' => [7, 1, new Scalar(7)],
    'a boolean' => [false, 1, new Scalar(false)],
    'some text' => ['started', 1, new Scalar('started')],
    'a day with a line break stays text' => ["2026-10-31\n", 1, new Scalar("2026-10-31\n")],
    'no calendar day stays text' => ['2026-02-30', 1, new Scalar('2026-02-30')],
]);

it('gives nothing for a value it cannot read', function (mixed $value) use ($me, $calendar) {
    expect(Operands::one($value, $me, $calendar()))->toBeNull();
})->with([
    'months are no unit' => [['relative' => '+7m']],
    'six digits' => [['relative' => '+100000d']],
    'relative without text' => [['relative' => 7]],
    'an object without relative' => [['days' => 7]],
    'null' => [null],
]);

it('reads one value as a list of one and leaves out what it cannot read', function () use ($me, $calendar) {
    expect(Operands::of('today', $me, $calendar()))->toEqual([new DayRange('2026-10-28', '2026-10-28')])
        ->and(Operands::of(['me', ['relative' => '+7m'], 'started'], $me, $calendar()))->toEqual([new Scalar($me), new Scalar('started')])
        ->and(Operands::of(['relative' => '+1w'], $me, $calendar()))->toEqual([new DayRange('2026-11-04', '2026-11-04')])
        ->and(Operands::of(null, $me, $calendar()))->toBe([])
        ->and(Operands::of([], $me, $calendar()))->toBe([]);
});
