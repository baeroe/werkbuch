<?php

use App\Models\Organization;
use App\Views\Calendar;
use Illuminate\Support\Carbon;

it('is the calendar of the organisation now', function () {
    Organization::current()->update(['timezone' => 'Pacific/Auckland', 'week_start' => 0]);
    $this->travelTo(Carbon::parse('2026-10-28 12:30', 'UTC'));

    $calendar = Calendar::current();

    // 01:30 on the 29th in Auckland (UTC+13)
    expect($calendar->zone->getName())->toBe('Pacific/Auckland')
        ->and($calendar->weekStart)->toBe(0)
        ->and($calendar->now->format(DATE_ATOM))->toBe('2026-10-28T12:30:00+00:00')
        ->and($calendar->today())->toBe('2026-10-29');

    $this->travelTo(Carbon::parse('2026-10-28 10:00', 'UTC'));

    expect(Calendar::current()->today())->toBe('2026-10-28');
});
