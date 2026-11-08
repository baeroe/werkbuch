<?php

namespace Tests\Load\Support;

use App\Access\Visibility;
use Closure;
use Illuminate\Database\Events\QueryExecuted;
use Illuminate\Support\Facades\DB;

/**
 * The budget of the load suite (A187, K10): 1.5 s per answer as the median of three runs after a warm-up run. Before
 * every run the app forgets its scoped instances and the visibility (Laravel keeps them between two requests of a test;
 * Organization::current(), RoleIndex and CatalogProperties would come from memory and save queries a real request
 * makes). The query count is the hard check, the wall clock only the median against the budget. Every measured row
 * goes into a table, written to storage/logs/load-budget.md after each row and printed at the end of the suite.
 */
final class Budget
{
    /** The budget of one answer in seconds (A187). */
    public const SECONDS = 1.5;

    /** The runs after the warm-up; the median is the middle one. */
    public const RUNS = 3;

    /** @var array<string, array{median: float, runs: list<float>, queries: list<int>, baseline: ?int, budget: float}> */
    private static array $rows = [];

    /** @var array<string, int>|null the queries of every row in the small world, once per process */
    private static ?array $baselines = null;

    private static mixed $answer = null;

    private static int $counted = 0;

    /** The app whose queries are counted (a test boots its own app, so its listener is registered again). */
    private static ?object $listening = null;

    /**
     * Runs `$request` once to warm up, then RUNS times, and records the median of the runs and the queries of each.
     */
    public static function measure(string $name, Closure $request, float $seconds = self::SECONDS, ?int $baseline = null): float
    {
        self::prepare();
        self::$answer = $request();

        $runs = [];
        $queries = [];
        for ($i = 0; $i < self::RUNS; $i++) {
            self::prepare();
            $started = hrtime(true);
            $request();
            $runs[] = (hrtime(true) - $started) / 1e9;
            $queries[] = self::$counted;
        }

        $sorted = $runs;
        sort($sorted);
        $median = $sorted[intdiv(self::RUNS, 2)];
        self::$rows[$name] = ['median' => $median, 'runs' => $runs, 'queries' => $queries, 'baseline' => $baseline, 'budget' => $seconds];
        self::write();

        return $median;
    }

    /** The queries `$request` makes after a warm-up run, with the same preparations as measure(). */
    public static function queries(Closure $request): int
    {
        self::prepare();
        $request();
        self::prepare();
        $request();

        return self::$counted;
    }

    /** What the warm-up run of the last measure() returned. */
    public static function answer(): mixed
    {
        return self::$answer;
    }

    /**
     * @return array{median: float, runs: list<float>, queries: list<int>, baseline: ?int, budget: float}
     */
    public static function row(string $name): array
    {
        return self::$rows[$name];
    }

    /** @return array<string, int>|null */
    public static function baselines(): ?array
    {
        return self::$baselines;
    }

    /** @param array<string, int> $counts */
    public static function rememberBaselines(array $counts): void
    {
        self::$baselines = $counts;
    }

    /**
     * The table of every measured row, in the order they ran; the rows of `$over` (name => task and reason) are marked.
     *
     * @param  array<string, string>  $over
     */
    public static function table(array $over = []): string
    {
        $lines = [
            '# Load budget',
            '',
            sprintf('Median of %d runs after a warm-up, budget %.1f s per answer; queries per run and against 100 items.', self::RUNS, self::SECONDS),
            '',
            '| Row | Median ms | Runs ms | Queries | Against 100 items | Status |',
            '|---|---:|---|---:|---:|---|',
        ];

        foreach (self::$rows as $name => $row) {
            $status = match (true) {
                $row['median'] <= $row['budget'] => 'ok',
                isset($over[$name]) => 'over: '.$over[$name],
                default => 'OVER',
            };
            $lines[] = sprintf(
                '| %s | %.0f | %s | %s | %s | %s |',
                $name,
                $row['median'] * 1_000,
                implode(' / ', array_map(fn (float $run) => sprintf('%.0f', $run * 1_000), $row['runs'])),
                implode(' / ', array_unique($row['queries'])),
                $row['baseline'] ?? '–',
                $status,
            );
        }

        return implode("\n", $lines)."\n";
    }

    /** Where the table goes: storage/logs of the repository, the artifact `load-budget` of the CI job `load`. */
    public static function path(): string
    {
        return dirname(__DIR__, 3).'/storage/logs/load-budget.md';
    }

    /**
     * Writes the table to path(); measure() writes it after every row, so a run that breaks off still leaves one.
     *
     * @param  array<string, string>  $over
     */
    public static function write(array $over = []): void
    {
        file_put_contents(self::path(), self::table($over));
    }

    /** Forgets what the app keeps between two requests of a test and starts counting anew. */
    private static function prepare(): void
    {
        app()->forgetScopedInstances();
        Visibility::forget();

        if (self::$listening !== app()) {
            self::$listening = app();
            DB::listen(function (QueryExecuted $query): void {
                self::$counted++;
            });
        }

        self::$counted = 0;
    }
}
