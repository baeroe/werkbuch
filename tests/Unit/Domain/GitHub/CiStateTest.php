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

it('keeps only the newest attempt of each check of a kind, app and name, in the order given (WEBU-62)', function () {
    $row = fn (int $id, string $name, string $conclusion, string $kind = 'check', ?string $app = 'GitHub Actions') => ['kind' => $kind, 'app' => $app, 'name' => $name, 'id' => $id, 'status' => 'completed', 'conclusion' => $conclusion];
    $runs = [$row(1, 'e2e', 'failure'), $row(2, 'lint', 'success'), $row(3, 'e2e', 'success'), $row(4, 'e2e', 'success', 'status', null), $row(5, 'e2e', 'failure', 'check', 'Other')];

    expect(array_column(CiState::latest($runs), 'id'))->toBe([2, 3, 4, 5])
        ->and(CiState::of(CiState::latest([$row(1, 'e2e', 'failure'), $row(3, 'e2e', 'success')])))->toBe(CiState::SUCCESS)
        ->and(CiState::of(CiState::latest([$row(3, 'e2e', 'failure'), $row(1, 'e2e', 'success')])))->toBe(CiState::FAILURE)
        ->and(CiState::latest([]))->toBe([]);
});
