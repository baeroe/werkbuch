<?php

use App\Domain\Schedule\WallClock;

$utc = fn (DateTimeImmutable $instant): string => $instant->getTimezone()->getName().' '.$instant->format('Y-m-d H:i');

$berlin = new DateTimeZone('Europe/Berlin');

it('turns a wall-clock time into an instant in UTC', function () use ($utc, $berlin) {
    expect($utc(WallClock::at('2026-10-28', '09:00', $berlin)))->toBe('UTC 2026-10-28 08:00')
        ->and($utc(WallClock::at('2026-07-01', '09:00', $berlin)))->toBe('UTC 2026-07-01 07:00')
        ->and($utc(WallClock::at('2026-10-28', '09:00', new DateTimeZone('America/New_York'))))->toBe('UTC 2026-10-28 13:00');
});

it('moves a time in the gap of spring forward by the length of the gap', function () use ($utc, $berlin) {
    // 02:00 to 03:00 does not exist on 2027-03-28: 02:30 is 03:30 summer time
    expect($utc(WallClock::at('2027-03-28', '02:30', $berlin)))->toBe('UTC 2027-03-28 01:30')
        ->and($utc(WallClock::at('2027-03-28', '02:00', $berlin)))->toBe('UTC 2027-03-28 01:00')
        ->and($utc(WallClock::at('2027-03-28', '03:00', $berlin)))->toBe('UTC 2027-03-28 01:00');
});

it('takes the first of an hour that happens twice in autumn', function () use ($utc, $berlin) {
    // 02:00 to 03:00 happens twice on 2026-10-25: the first 02:30 is summer time (UTC+2)
    expect($utc(WallClock::at('2026-10-25', '02:30', $berlin)))->toBe('UTC 2026-10-25 00:30')
        ->and($utc(WallClock::at('2026-10-25', '03:00', $berlin)))->toBe('UTC 2026-10-25 02:00')
        ->and($utc(WallClock::at('2026-11-01', '01:30', new DateTimeZone('America/New_York'))))->toBe('UTC 2026-11-01 05:30');
});

it('counts in Kolkata with its half hour', function () use ($utc) {
    $kolkata = new DateTimeZone('Asia/Kolkata');

    expect($utc(WallClock::at('2026-10-28', '09:00', $kolkata)))->toBe('UTC 2026-10-28 03:30')
        ->and($utc(WallClock::at('2026-10-28', '02:00', $kolkata)))->toBe('UTC 2026-10-27 20:30')
        ->and(WallClock::day(new DateTimeImmutable('2026-10-31T19:00:00Z'), $kolkata))->toBe('2026-11-01')
        ->and(WallClock::day(new DateTimeImmutable('2026-10-31T18:29:00Z'), $kolkata))->toBe('2026-10-31');
});

it('gives the day an instant falls on in the zone', function () use ($berlin) {
    // 23:30 UTC on Halloween is already the next day in Berlin
    expect(WallClock::day(new DateTimeImmutable('2026-10-31T23:30:00Z'), $berlin))->toBe('2026-11-01')
        ->and(WallClock::day(new DateTimeImmutable('2026-10-31T23:30:00Z'), new DateTimeZone('UTC')))->toBe('2026-10-31')
        ->and(WallClock::day(new DateTimeImmutable('2026-11-01 01:00', new DateTimeZone('Asia/Kolkata')), $berlin))->toBe('2026-10-31');
});

it('refuses a day or a time that does not exist', function () use ($berlin) {
    foreach ([['2026-02-30', '09:00'], ['2026-10-28', '24:00'], ['soon', '09:00'], ['2026-10-28', '9']] as [$day, $time]) {
        expect(fn () => WallClock::at($day, $time, $berlin))->toThrow(InvalidArgumentException::class);
    }
});
