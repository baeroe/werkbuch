<?php

use App\Domain\GitHub\CiState;

/*
 * The CI state of a PR from its check runs on the head commit (spec 7.2, 12): green when every run is done and none
 * failed, red as soon as one fails, pending while one runs, none without any.
 */

$run = fn (string $status, ?string $conclusion = null) => ['status' => $status, 'conclusion' => $conclusion];

it('is none without a check, pending while one runs, success when all ended well', function () use ($run) {
    expect(CiState::of([]))->toBe(CiState::NONE)
        ->and(CiState::of([$run('queued'), $run('completed', 'success')]))->toBe(CiState::PENDING)
        ->and(CiState::of([$run('in_progress')]))->toBe(CiState::PENDING)
        ->and(CiState::of([$run('completed', 'success'), $run('completed', 'neutral'), $run('completed', 'skipped')]))->toBe(CiState::SUCCESS);
});

it('is red as soon as one run fails, even while others run', function () use ($run) {
    foreach (['failure', 'cancelled', 'timed_out', 'action_required', 'stale'] as $conclusion) {
        expect(CiState::of([$run('in_progress'), $run('completed', $conclusion)]))->toBe(CiState::FAILURE, $conclusion);
    }
});
