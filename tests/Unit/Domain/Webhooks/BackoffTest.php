<?php

use App\Domain\Webhooks\Backoff;

it('spreads eight tries over 24 hours', function () {
    $delays = array_map(fn (int $attempt) => Backoff::delayAfter($attempt), range(1, Backoff::TRIES - 1));

    expect(Backoff::TRIES)->toBe(8)
        ->and(Backoff::OFFSETS)->toHaveCount(Backoff::TRIES)
        ->and(Backoff::OFFSETS[0])->toBe(0)
        ->and(array_sum($delays))->toBe(86400)
        ->and(Backoff::OFFSETS[Backoff::TRIES - 1])->toBe(86400);
});

it('waits 1 min, 5 min, 30 min, 2 h, 6 h, 12 h and 3 h 24 min', function () {
    expect(Backoff::delayAfter(1))->toBe(60)
        ->and(Backoff::delayAfter(2))->toBe(300)
        ->and(Backoff::delayAfter(3))->toBe(1800)
        ->and(Backoff::delayAfter(4))->toBe(7200)
        ->and(Backoff::delayAfter(5))->toBe(21600)
        ->and(Backoff::delayAfter(6))->toBe(43200)
        ->and(Backoff::delayAfter(7))->toBe(12240);
});

it('knows no pause before the first or after the last try', function (int $attempt) {
    expect(fn () => Backoff::delayAfter($attempt))->toThrow(InvalidArgumentException::class);
})->with([0, 8, -1]);
