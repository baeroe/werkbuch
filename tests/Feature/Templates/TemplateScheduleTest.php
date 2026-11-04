<?php

use App\Domain\Schedule\Schedule;
use App\Support\TemplateSchedule;

// When the scheduler next looks at a template (spec 4.12, A339) and the names of the months for its title.

/** A schedule in the normal form, weekly on Monday at 09:00 from 2026-10-26 on unless changed. */
$schedule = fn (array $changes = []): Schedule => Schedule::parse([
    'frequency' => 'weekly', 'interval' => 1, 'weekdays' => [1], 'time' => '09:00', 'starts_on' => '2026-10-26',
    'ends' => ['type' => 'never'], 'paused' => false, ...$changes,
]);

$utc = fn (string $at): DateTimeImmutable => new DateTimeImmutable($at, new DateTimeZone('UTC'));

$text = fn (?DateTimeImmutable $at): ?string => $at?->setTimezone(new DateTimeZone('UTC'))->format('Y-m-d H:i');

it('gives the first term after now when none is due', function () use ($schedule, $utc, $text) {
    $now = $utc('2026-10-28 09:00');

    expect($text(TemplateSchedule::nextRunAt($schedule(), $now, 0, $now, new DateTimeZone('Europe/Berlin'))))->toBe('2026-11-02 08:00')
        ->and($text(TemplateSchedule::nextRunAt($schedule(), $now, 0, $now, new DateTimeZone('America/New_York'))))->toBe('2026-11-02 14:00')
        ->and($text(TemplateSchedule::nextRunAt($schedule(), $now, 0, $now, new DateTimeZone('Asia/Kolkata'))))->toBe('2026-11-02 03:30');
});

it('gives the latest missed term when one is due', function () use ($schedule, $utc, $text) {
    $zone = new DateTimeZone('Europe/Berlin');
    $since = $utc('2026-10-27 12:00');

    // three Mondays missed (2 Nov, 9 Nov, 16 Nov): the scheduler is to look at the last of them now
    expect($text(TemplateSchedule::nextRunAt($schedule(), $since, 1, $utc('2026-11-18 10:00'), $zone)))->toBe('2026-11-16 08:00')
        // a term at now is due
        ->and($text(TemplateSchedule::nextRunAt($schedule(), $since, 1, $utc('2026-11-02 08:00'), $zone)))->toBe('2026-11-02 08:00')
        // without a moment since when it counts, from its start day
        ->and($text(TemplateSchedule::nextRunAt($schedule(), null, 0, $utc('2026-10-28 09:00'), $zone)))->toBe('2026-10-26 08:00')
        // a clock set back never gives the term that ran again
        ->and($text(TemplateSchedule::nextRunAt($schedule(), $utc('2026-11-02 08:00'), 1, $utc('2026-11-02 07:59'), $zone)))->toBe('2026-11-09 08:00');
});

it('gives no term for no schedule, a paused one or one whose runs are used up', function () use ($schedule, $utc) {
    $zone = new DateTimeZone('Europe/Berlin');
    $now = $utc('2026-10-28 09:00');

    expect(TemplateSchedule::nextRunAt(null, $now, 0, $now, $zone))->toBeNull()
        ->and(TemplateSchedule::nextRunAt($schedule(['paused' => true]), $now, 0, $now, $zone))->toBeNull()
        ->and(TemplateSchedule::nextRunAt($schedule(['ends' => ['type' => 'count', 'count' => 3]]), $now, 3, $now, $zone))->toBeNull()
        ->and(TemplateSchedule::nextRunAt($schedule(['ends' => ['type' => 'on', 'date' => '2026-10-31']]), $now, 0, $now, $zone))->toBeNull();
});

it('names the months in the language asked', function () {
    expect(TemplateSchedule::monthNames('de'))->toBe([
        1 => 'Januar', 2 => 'Februar', 3 => 'März', 4 => 'April', 5 => 'Mai', 6 => 'Juni', 7 => 'Juli', 8 => 'August',
        9 => 'September', 10 => 'Oktober', 11 => 'November', 12 => 'Dezember',
    ])
        ->and(TemplateSchedule::monthNames('en'))->toBe([
            1 => 'January', 2 => 'February', 3 => 'March', 4 => 'April', 5 => 'May', 6 => 'June', 7 => 'July', 8 => 'August',
            9 => 'September', 10 => 'October', 11 => 'November', 12 => 'December',
        ]);
});
