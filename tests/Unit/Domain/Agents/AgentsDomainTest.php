<?php

use App\Domain\Agents\AgentCli;
use App\Domain\Agents\Places;
use App\Domain\Agents\RunStatus;
use App\Domain\Agents\RunType;

it('knows the kinds of run with their fixed limits, pots, order and abilities', function () {
    expect(array_map(fn (RunType $type) => $type->value, RunType::cases()))->toBe(RunType::VALUES)
        ->and(array_map(fn (RunType $type) => $type->timeoutMinutes(), RunType::cases()))->toBe([60, 60, 30, 20, 10])
        ->and(array_map(fn (RunType $type) => $type->light(), RunType::cases()))->toBe([false, false, false, true, true])
        ->and(array_map(fn (RunType $type) => $type->urgent(), RunType::cases()))->toBe([false, true, true, true, false])
        ->and(RunType::Task->abilities())->toBe(['read', 'write', 'mcp'])
        ->and(RunType::Review->abilities())->toBe(['read', 'mcp']);
});

it('knows the life of a run', function () {
    expect(array_map(fn (RunStatus $status) => $status->value, RunStatus::cases()))->toBe(RunStatus::VALUES)
        ->and(array_values(array_filter(RunStatus::VALUES, fn (string $value) => RunStatus::from($value)->pending())))->toBe(['queued', 'waiting'])
        ->and(array_values(array_filter(RunStatus::VALUES, fn (string $value) => RunStatus::from($value)->busy())))->toBe(['running', 'canceling'])
        ->and(array_values(array_filter(RunStatus::VALUES, fn (string $value) => RunStatus::from($value)->finished())))->toBe(['succeeded', 'failed', 'canceled', 'timed_out', 'lost'])
        ->and(array_values(array_filter(RunStatus::VALUES, fn (string $value) => RunStatus::from($value)->retryable())))->toBe(['failed', 'canceled', 'timed_out', 'lost']);
});

it('knows the models of each CLI from a fixed list', function () {
    expect(array_map(fn (AgentCli $cli) => $cli->value, AgentCli::cases()))->toBe(AgentCli::VALUES)
        ->and(AgentCli::Claude->knows('opus'))->toBeTrue()
        ->and(AgentCli::Claude->knows('gpt-5-codex'))->toBeFalse()
        ->and(AgentCli::Codex->knows(AgentCli::Codex->defaultModel()))->toBeTrue()
        ->and(AgentCli::Claude->knows(AgentCli::Claude->defaultModel()))->toBeTrue();
});

it('fits code runs in all and per repo, and light runs only in their own pot', function () {
    $places = new Places(total: 2, perRepo: 1, light: 2);
    $task = fn (string $repo) => ['type' => RunType::Task, 'repo' => $repo];
    $review = fn (string $repo) => ['type' => RunType::Review, 'repo' => $repo];

    expect($places->fits(RunType::Task, 'a', []))->toBeTrue()
        ->and($places->fits(RunType::Task, 'a', [$task('a')]))->toBeFalse()
        ->and($places->fits(RunType::Conflict, 'b', [$task('a')]))->toBeTrue()
        ->and($places->fits(RunType::Task, 'c', [$task('a'), $task('b')]))->toBeFalse()
        // light runs never count against code places, and code runs never against the light pot
        ->and($places->fits(RunType::Task, 'b', [$task('a'), $review('b'), $review('b')]))->toBeTrue()
        ->and($places->fits(RunType::Comment, 'a', [$task('a'), $task('b'), $review('a')]))->toBeTrue()
        ->and($places->fits(RunType::Review, 'a', [$review('a'), $review('b')]))->toBeFalse()
        ->and(Places::used([$task('a'), $task('a'), $task('b'), $review('b')]))->toBe(['total' => 3, 'per_repo' => 2, 'light' => 1])
        ->and(Places::used([]))->toBe(['total' => 0, 'per_repo' => 0, 'light' => 0]);
});

