<?php

use App\Domain\Automations\NightlyRun;

$utc = fn (string $time): DateTimeImmutable => new DateTimeImmutable($time, new DateTimeZone('UTC'));
$berlin = new DateTimeZone('Europe/Berlin');
$newYork = new DateTimeZone('America/New_York');
$kolkata = new DateTimeZone('Asia/Kolkata');

it('runs at 03:00 in Berlin, in winter and in summer', function () use ($utc, $berlin) {
    expect(NightlyRun::HOUR)->toBe(3)
        ->and(NightlyRun::isDue($utc('2026-01-15 02:00'), $berlin))->toBeTrue()
        ->and(NightlyRun::isDue($utc('2026-01-15 01:00'), $berlin))->toBeFalse()
        ->and(NightlyRun::isDue($utc('2026-07-15 01:00'), $berlin))->toBeTrue()
        ->and(NightlyRun::isDue($utc('2026-07-15 02:00'), $berlin))->toBeFalse();
});

it('runs once on the days the clocks change in Berlin', function () use ($utc, $berlin) {
    $hours = fn (string $day) => array_values(array_filter(range(0, 23), fn (int $h) => NightlyRun::isDue($utc(sprintf('%s %02d:00', $day, $h)), $berlin)));

    expect($hours('2026-03-29'))->toBe([1])
        ->and($hours('2026-10-25'))->toBe([2]);
});

it('runs at 03:00 in New York', function () use ($utc, $newYork) {
    expect(NightlyRun::isDue($utc('2026-03-08 07:00'), $newYork))->toBeTrue()
        ->and(NightlyRun::isDue($utc('2026-03-08 08:00'), $newYork))->toBeFalse()
        ->and(NightlyRun::isDue($utc('2026-11-01 08:00'), $newYork))->toBeTrue()
        ->and(NightlyRun::isDue($utc('2026-11-01 07:00'), $newYork))->toBeFalse();
});

it('runs in the hour of 21:30 UTC in Kolkata', function () use ($utc, $kolkata) {
    expect(NightlyRun::isDue($utc('2026-10-04 21:30'), $kolkata))->toBeTrue()
        ->and(NightlyRun::isDue($utc('2026-10-04 22:29'), $kolkata))->toBeTrue()
        ->and(NightlyRun::isDue($utc('2026-10-04 21:29'), $kolkata))->toBeFalse()
        ->and(NightlyRun::isDue($utc('2026-10-04 22:30'), $kolkata))->toBeFalse();
});
