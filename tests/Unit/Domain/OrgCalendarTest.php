<?php

use App\Domain\Time\OrgCalendar;

$calendar = fn (string $zone, int $weekStart = 1, string $now = '2026-10-27T23:30:00Z'): OrgCalendar => new OrgCalendar(new DateTimeZone($zone), $weekStart, new DateTimeImmutable($now));

$utc = fn (DateTimeImmutable $instant): string => $instant->setTimezone(new DateTimeZone('UTC'))->format('Y-m-d\TH:i:s\Z');

it('gives today in the zone of the organisation', function () use ($calendar) {
    // 23:30 UTC is 00:30 on the next day in Berlin (winter time, UTC+1)
    expect($calendar('Europe/Berlin')->today())->toBe('2026-10-28')
        ->and($calendar('UTC')->today())->toBe('2026-10-27')
        // 22:30 UTC is still 23:30 on the same day in Berlin
        ->and($calendar('Europe/Berlin', 1, '2026-10-27T22:30:00Z')->today())->toBe('2026-10-27');
});

it('starts the week on monday or on sunday', function () use ($calendar) {
    // 2026-10-28 is a Wednesday
    expect($calendar('UTC', 1)->startOfWeek('2026-10-28'))->toBe('2026-10-26')
        ->and($calendar('UTC', 0)->startOfWeek('2026-10-28'))->toBe('2026-10-25')
        // the first day of the week is the start of its own week
        ->and($calendar('UTC', 1)->startOfWeek('2026-10-26'))->toBe('2026-10-26')
        ->and($calendar('UTC', 0)->startOfWeek('2026-11-01'))->toBe('2026-11-01')
        ->and($calendar('UTC', 1)->startOfWeek('2026-11-01'))->toBe('2026-10-26')
        ->and($calendar('UTC', 6)->startOfWeek('2026-10-28'))->toBe('2026-10-24');
});

it('covers the whole calendar month', function () use ($calendar) {
    $calendar = $calendar('UTC');

    expect($calendar->startOfMonth('2026-02-10'))->toBe('2026-02-01')
        ->and($calendar->endOfMonth('2026-02-10'))->toBe('2026-02-28')
        ->and($calendar->endOfMonth('2028-02-10'))->toBe('2028-02-29')
        ->and($calendar->endOfMonth('2026-10-28'))->toBe('2026-10-31');
});

it('adds days across months, years and the change of the clocks', function () use ($calendar) {
    $calendar = $calendar('Europe/Berlin');

    expect($calendar->addDays('2026-10-28', 7))->toBe('2026-11-04')
        ->and($calendar->addDays('2026-10-28', -14))->toBe('2026-10-14')
        ->and($calendar->addDays('2026-12-31', 1))->toBe('2027-01-01')
        ->and($calendar->addDays('2026-10-24', 1))->toBe('2026-10-25')
        ->and($calendar->addDays('2026-03-29', 1))->toBe('2026-03-30')
        ->and($calendar->addDays('2026-10-28', 0))->toBe('2026-10-28');
});

it('turns the day at the right hour in winter time and in summer time', function () use ($calendar, $utc) {
    $berlin = $calendar('Europe/Berlin');

    // the clocks go back on 2026-10-25 and forward on 2026-03-29
    expect($utc($berlin->dayStart('2026-10-25')))->toBe('2026-10-24T22:00:00Z')
        ->and($utc($berlin->dayStart('2026-10-26')))->toBe('2026-10-25T23:00:00Z')
        ->and($utc($berlin->dayStart('2026-03-29')))->toBe('2026-03-28T23:00:00Z')
        ->and($utc($berlin->dayStart('2026-03-30')))->toBe('2026-03-29T22:00:00Z')
        ->and($berlin->dayStart('2026-10-26')->getTimezone()->getName())->toBe('UTC');
});

it('starts a day whose midnight the clocks skip at its first hour', function () use ($calendar, $utc) {
    // Chile moves the clocks from 00:00 to 01:00 on 2026-09-06
    expect($utc($calendar('America/Santiago')->dayStart('2026-09-06')))->toBe('2026-09-06T04:00:00Z');
});

it('reads the day of an instant', function () use ($calendar) {
    $berlin = $calendar('Europe/Berlin');

    expect($berlin->dayOf(new DateTimeImmutable('2026-10-27T23:30:00Z')))->toBe('2026-10-28')
        ->and($berlin->dayOf(new DateTimeImmutable('2026-10-27T22:59:59Z')))->toBe('2026-10-27')
        ->and($berlin->dayOf(new DateTimeImmutable('2026-10-27T23:00:00Z')))->toBe('2026-10-28')
        ->and($calendar('UTC')->dayOf(new DateTimeImmutable('2026-10-27T23:30:00+02:00')))->toBe('2026-10-27');
});

it('refuses a day that is none and a week start outside the week', function () use ($calendar) {
    expect(fn () => $calendar('UTC')->addDays('2026-02-30', 1))->toThrow(InvalidArgumentException::class, '2026-02-30')
        ->and(fn () => $calendar('UTC')->dayStart("2026-10-28\n"))->toThrow(InvalidArgumentException::class)
        ->and(fn () => $calendar('UTC', 7))->toThrow(InvalidArgumentException::class, '7')
        ->and(fn () => $calendar('UTC', -1))->toThrow(InvalidArgumentException::class);
});
