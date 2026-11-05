<?php

use App\Domain\Schedule\Offsets;

it('gives no day without an offset', function () {
    expect(Offsets::day('2026-10-28', null))->toBeNull();
});

it('gives the day itself for an offset of zero', function () {
    expect(Offsets::day('2026-10-28', 0))->toBe('2026-10-28');
});

it('counts days across the end of a month and a year', function () {
    expect(Offsets::day('2026-10-28', 14))->toBe('2026-11-11')
        ->and(Offsets::day('2026-12-25', 14))->toBe('2027-01-08')
        ->and(Offsets::day('2028-02-20', 14))->toBe('2028-03-05')
        // a day has no zone: the change of the clocks on 2026-10-25 does not move it
        ->and(Offsets::day('2026-10-24', 1))->toBe('2026-10-25');
});

it('refuses a text that is no day', function () {
    expect(fn () => Offsets::day('2026-02-30', 1))->toThrow(InvalidArgumentException::class);
});
