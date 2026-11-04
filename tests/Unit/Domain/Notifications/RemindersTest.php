<?php

use App\Domain\Notifications\Reminders;

$utc = fn (string $time): DateTimeImmutable => new DateTimeImmutable($time, new DateTimeZone('UTC'));
$berlin = new DateTimeZone('Europe/Berlin');
$newYork = new DateTimeZone('America/New_York');
$kolkata = new DateTimeZone('Asia/Kolkata');

it('finds 08:00 in Berlin on the day the clocks go back', function () use ($utc, $berlin) {
    // 2026-10-25: 03:00 summer time becomes 02:00 winter time, so 08:00 is 07:00 UTC (the day before 06:00 UTC)
    expect(Reminders::isReminderHour($utc('2026-10-25 07:00'), $berlin))->toBeTrue()
        ->and(Reminders::isReminderHour($utc('2026-10-25 07:59:59'), $berlin))->toBeTrue()
        ->and(Reminders::isReminderHour($utc('2026-10-25 06:00'), $berlin))->toBeFalse()
        ->and(Reminders::isReminderHour($utc('2026-10-24 06:00'), $berlin))->toBeTrue()
        ->and(Reminders::isReminderHour($utc('2026-10-24 07:00'), $berlin))->toBeFalse()
        ->and(Reminders::localDay($utc('2026-10-25 07:00'), $berlin))->toBe('2026-10-25');
});

it('finds 08:00 in Berlin on the day the clocks go forward, and in New York on the days they change (T3-M3)', function () use ($utc, $berlin, $newYork) {
    // 2026-03-29: 02:00 winter time becomes 03:00 summer time, so 08:00 is 06:00 UTC (the day before 07:00 UTC)
    expect(Reminders::isReminderHour($utc('2026-03-29 06:00'), $berlin))->toBeTrue()
        ->and(Reminders::isReminderHour($utc('2026-03-29 07:00'), $berlin))->toBeFalse()
        ->and(Reminders::isReminderHour($utc('2026-03-28 07:00'), $berlin))->toBeTrue()
        // New York: 2026-03-08 forward (08:00 EDT = 12:00 UTC), 2026-11-01 back (08:00 EST = 13:00 UTC)
        ->and(Reminders::isReminderHour($utc('2026-03-08 12:00'), $newYork))->toBeTrue()
        ->and(Reminders::isReminderHour($utc('2026-03-08 13:00'), $newYork))->toBeFalse()
        ->and(Reminders::isReminderHour($utc('2026-11-01 13:00'), $newYork))->toBeTrue()
        ->and(Reminders::isReminderHour($utc('2026-11-01 12:00'), $newYork))->toBeFalse()
        ->and(Reminders::localDay($utc('2026-11-01 13:00'), $newYork))->toBe('2026-11-01');
});

it('finds 08:30 in Kolkata in the hour of 03:00 UTC', function () use ($utc, $kolkata) {
    expect(Reminders::isReminderHour($utc('2026-10-25 03:00'), $kolkata))->toBeTrue()
        ->and(Reminders::isReminderHour($utc('2026-10-25 02:30'), $kolkata))->toBeTrue()
        ->and(Reminders::isReminderHour($utc('2026-10-25 02:29'), $kolkata))->toBeFalse()
        ->and(Reminders::isReminderHour($utc('2026-10-25 03:30'), $kolkata))->toBeFalse();
});

it('is not the hour at 07:59', function () use ($utc, $newYork, $berlin) {
    // New York is still on summer time until 2026-11-01: 07:59 there is 11:59 UTC
    expect(Reminders::isReminderHour($utc('2026-10-28 11:59'), $newYork))->toBeFalse()
        ->and(Reminders::isReminderHour($utc('2026-10-28 12:00'), $newYork))->toBeTrue()
        ->and(Reminders::isReminderHour($utc('2026-10-28 13:00'), $newYork))->toBeFalse()
        ->and(Reminders::isReminderHour($utc('2026-11-03 06:59'), $berlin))->toBeFalse()
        ->and(Reminders::isReminderHour($utc('2026-11-03 20:00'), $berlin))->toBeFalse();
});

it('reads due today and overdue in the person\'s calendar', function () use ($utc, $berlin, $newYork) {
    $now = $utc('2026-11-02 23:30');
    $inBerlin = Reminders::localDay($now, $berlin);
    $inNewYork = Reminders::localDay($now, $newYork);

    expect($inBerlin)->toBe('2026-11-03')
        ->and($inNewYork)->toBe('2026-11-02')
        ->and(Reminders::dueKind('2026-11-02', $inBerlin))->toBeTrue()
        ->and(Reminders::dueKind('2026-11-02', $inNewYork))->toBeFalse()
        ->and(Reminders::dueKind('2026-11-03', $inBerlin))->toBeFalse()
        ->and(Reminders::dueKind('2026-11-03', $inNewYork))->toBeNull()
        ->and(Reminders::dueKind('2025-12-31', '2026-01-01'))->toBeTrue()
        ->and(Reminders::dueKind('2027-01-01', '2026-12-31'))->toBeNull();
});

it('refuses a due date or a today that is no day', function (string $due, string $today) {
    expect(fn () => Reminders::dueKind($due, $today))->toThrow(InvalidArgumentException::class);
})->with([['2026-11-3', '2026-11-03'], ['2026-11-03', 'today'], ['2026-02-30', '2026-03-01']]);
