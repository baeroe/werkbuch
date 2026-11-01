<?php

use App\Domain\WorkItems\DateRange;

it('reads a day only in the form YYYY-MM-DD', function () {
    expect(DateRange::isDay('2026-10-31'))->toBeTrue()
        ->and(DateRange::isDay('2028-02-29'))->toBeTrue()
        ->and(DateRange::isDay('2026-02-30'))->toBeFalse()
        ->and(DateRange::isDay('31.10.2026'))->toBeFalse()
        ->and(DateRange::isDay("2026-10-31\n"))->toBeFalse()
        ->and(DateRange::isDay('2026-10-31T10:00'))->toBeFalse();
});

it('knows when the start lies after the due date', function () {
    expect(DateRange::startAfterDue('2026-11-02', '2026-11-01'))->toBeTrue()
        ->and(DateRange::startAfterDue('2026-11-01', '2026-11-01'))->toBeFalse()
        ->and(DateRange::startAfterDue('2026-10-31', '2026-11-01'))->toBeFalse()
        ->and(DateRange::startAfterDue(null, '2026-11-01'))->toBeFalse()
        ->and(DateRange::startAfterDue('2026-11-02', null))->toBeFalse()
        ->and(DateRange::startAfterDue(null, null))->toBeFalse();
});
