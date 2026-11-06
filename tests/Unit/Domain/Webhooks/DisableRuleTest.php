<?php

use App\Domain\Webhooks\DisableRule;

$utc = fn (string $time): DateTimeImmutable => new DateTimeImmutable($time, new DateTimeZone('UTC'));

it('never disables a webhook that is not failing', function () use ($utc) {
    expect(DisableRule::disables(null, $utc('2026-11-05 12:00')))->toBeFalse();
});

it('keeps a webhook that has failed for less than 24 hours', function () use ($utc) {
    expect(DisableRule::AFTER_SECONDS)->toBe(86400)
        ->and(DisableRule::disables($utc('2026-11-04 12:00:00'), $utc('2026-11-05 11:59:59')))->toBeFalse()
        ->and(DisableRule::disables($utc('2026-11-04 12:00:00.000001'), $utc('2026-11-05 12:00:00')))->toBeFalse()
        ->and(DisableRule::disables($utc('2026-11-05 12:00'), $utc('2026-11-05 12:00')))->toBeFalse();
});

it('disables a webhook that has failed for exactly 24 hours or longer', function () use ($utc) {
    expect(DisableRule::disables($utc('2026-11-04 12:00:00'), $utc('2026-11-05 12:00:00')))->toBeTrue()
        ->and(DisableRule::disables($utc('2026-11-04 12:00:00.250000'), $utc('2026-11-05 12:00:00.250000')))->toBeTrue()
        ->and(DisableRule::disables($utc('2026-11-01 12:00'), $utc('2026-11-05 12:00')))->toBeTrue();
});

it('counts real hours on the day the clocks change', function () {
    $berlin = new DateTimeZone('Europe/Berlin');

    // 2026-10-25 has 25 hours in Berlin: 24 real hours end at 11:00 on the wall clock
    expect(DisableRule::disables(new DateTimeImmutable('2026-10-24 12:00', $berlin), new DateTimeImmutable('2026-10-25 11:00', $berlin)))->toBeTrue()
        ->and(DisableRule::disables(new DateTimeImmutable('2026-10-24 12:00', $berlin), new DateTimeImmutable('2026-10-25 10:59:59', $berlin)))->toBeFalse();
});

it('compares instants across time zones', function () use ($utc) {
    expect(DisableRule::disables(new DateTimeImmutable('2026-11-04 13:00', new DateTimeZone('Europe/Berlin')), $utc('2026-11-05 12:00')))->toBeTrue()
        ->and(DisableRule::disables(new DateTimeImmutable('2026-11-04 13:00:01', new DateTimeZone('Europe/Berlin')), $utc('2026-11-05 12:00')))->toBeFalse();
});
