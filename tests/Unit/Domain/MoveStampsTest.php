<?php

use App\Domain\Workflow\StateCategory;
use App\Domain\WorkItems\MoveStamps;

$at = fn (string $time): DateTimeImmutable => new DateTimeImmutable($time);

it('sets started_at the first time an item is started', function () use ($at) {
    $stamps = MoveStamps::after(StateCategory::Backlog, StateCategory::Started, null, null, $at('2026-10-31 10:00'));

    expect($stamps['started_at'])->toEqual($at('2026-10-31 10:00'))
        ->and($stamps['closed_at'])->toBeNull();
});

it('keeps started_at on later moves and when the item is started again', function () use ($at) {
    $started = $at('2026-10-30 09:00');

    expect(MoveStamps::after(StateCategory::Started, StateCategory::Started, $started, null, $at('2026-10-31 10:00')))
        ->toBe(['started_at' => $started, 'closed_at' => null])
        ->and(MoveStamps::after(StateCategory::Unstarted, StateCategory::Started, $started, null, $at('2026-10-31 10:00'))['started_at'])->toBe($started);
});

it('clears closed_at when the item is reopened and keeps started_at', function () use ($at) {
    $started = $at('2026-10-29 09:00');
    $stamps = MoveStamps::after(StateCategory::Completed, StateCategory::Started, $started, $at('2026-10-30 09:00'), $at('2026-10-31 10:00'));

    expect($stamps)->toBe(['started_at' => $started, 'closed_at' => null]);
});

it('sets closed_at when an open item is closed', function () use ($at) {
    $now = $at('2026-10-31 10:00');

    expect(MoveStamps::after(StateCategory::Unstarted, StateCategory::Completed, null, null, $now))->toBe(['started_at' => null, 'closed_at' => $now]);
});

it('sets a new closed_at when a closed item moves to the other closed category', function () use ($at) {
    $now = $at('2026-10-31 10:00');

    expect(MoveStamps::after(StateCategory::Completed, StateCategory::Canceled, null, $at('2026-10-30 09:00'), $now)['closed_at'])->toBe($now);
});

it('keeps closed_at when a closed item moves within its category', function () use ($at) {
    $closed = $at('2026-10-30 09:00');

    expect(MoveStamps::after(StateCategory::Completed, StateCategory::Completed, null, $closed, $at('2026-10-31 10:00'))['closed_at'])->toBe($closed);
});
