<?php

use App\Events\EventType;
use App\Exceptions\Problem;
use App\Models\Event;
use App\Models\User;
use App\Support\Actor;
use Illuminate\Validation\ValidationException;
use Tests\Feature\Access\MatrixWorld;

/*
 * Every action × every kind of account (master plan: "jede Action steht in der Rechte-Matrix"). Allowed means: no
 * refusal (403, 404) and no other failure but a ValidationException; a row with an event succeeds and records it for
 * the account. Not allowed is a 403, and what the account must not see (`hidden`) a 404. The rows: matrix.php.
 */

/**
 * @return array<string, array{action: class-string, run: Closure(Actor, MatrixWorld, string): mixed, allowed?: list<string>, hidden?: list<string>, event?: EventType, system?: bool}>
 */
function matrixRows(): array
{
    return require __DIR__.'/matrix.php';
}

/**
 * What a call ended with: `ok`, `invalid` (ValidationException) or the status of a Problem; anything else is thrown.
 */
function matrixOutcome(Closure $call): int|string
{
    try {
        $call();

        return 'ok';
    } catch (ValidationException) {
        return 'invalid';
    } catch (Problem $problem) {
        return $problem->status;
    }
}

$rows = collect(matrixRows())->reject(fn (array $row) => $row['system'] ?? false)->map(fn (array $row) => [$row])->all();

it('lets exactly the allowed accounts run each action', function (array $row, string $column) {
    $w = MatrixWorld::build();
    $account = $w->account($column);
    $recorded = fn () => isset($row['event']) ? Event::query()->where('type', $row['event'])->where('actor_id', $account->id)->count() : 0;
    $before = $recorded();

    $outcome = matrixOutcome(fn () => ($row['run'])(actor($account), $w, $column));

    if (in_array($column, $row['hidden'] ?? [], true)) {
        expect($outcome)->toBe(404, "{$column} must not see what it acts on");
    } elseif (in_array($column, $row['allowed'] ?? [], true)) {
        expect($outcome)->toBeIn(isset($row['event']) ? ['ok'] : ['ok', 'invalid'], "{$column} may run it");

        if (isset($row['event'])) {
            expect($recorded())->toBe($before + 1, "{$column} records {$row['event']->value}");
        }
    } else {
        expect($outcome)->toBe(403, "{$column} is refused");
    }
})->with($rows)->with(MatrixWorld::COLUMNS);

it('runs the work of jobs as the system without failing', function () {
    $failures = [];

    foreach (collect(matrixRows())->filter(fn (array $row) => $row['system'] ?? false) as $name => $row) {
        $w = MatrixWorld::build();
        $outcome = matrixOutcome(fn () => ($row['run'])(Actor::system(User::defaultBot(), 'matrix'), $w, 'default_bot'));

        if ($outcome !== 'ok') {
            $failures[] = "{$name}: {$outcome}";
        }
    }

    expect($failures)->toBe([]);
});

it('has exactly one row for every action (new actions need one)', function () {
    $exempt = fn (string $file) => str_starts_with($file, 'app/Actions/Auth/') || str_starts_with($file, 'app/Actions/Setup/')
        || $file === 'app/Actions/Accounts/NextHandle.php';

    $actions = collect(appFiles('app/Actions'))->reject($exempt)
        ->map(fn (string $file) => 'App\\'.str_replace('/', '\\', substr($file, strlen('app/'), -strlen('.php'))))
        ->sort()->values()->all();
    $rows = collect(matrixRows())->pluck('action');

    expect($rows->duplicates()->values()->all())->toBe([])
        ->and($rows->sort()->values()->all())->toBe($actions);
});

it('knows every column', function () {
    $w = MatrixWorld::build();

    expect(fn () => $w->account('nobody'))->toThrow(InvalidArgumentException::class)
        ->and($w->project('outsider_private')->is($w->ops))->toBeTrue()
        ->and($w->project('outsider_public')->is($w->web))->toBeTrue();
});
