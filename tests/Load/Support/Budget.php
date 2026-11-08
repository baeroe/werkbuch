<?php

namespace Tests\Load\Support;

use App\Access\Visibility;
use Closure;
use Illuminate\Database\Events\QueryExecuted;
use Illuminate\Support\Facades\DB;
use Illuminate\Testing\TestResponse;

/**
 * The budget of the load suite (A187, K10): 1.5 s per answer as the median of three runs after a warm-up run. Before
 * every run the app forgets its scoped instances and the visibility (Laravel keeps them between two requests of a test;
 * Organization::current(), RoleIndex and CatalogProperties would come from memory and save queries a real request
 * makes). The query count is the hard check, the wall clock only the median against the budget. Every run that answers
 * with a TestResponse has to answer 200 (a fast 429 or 500 is no measurement). Every measured row goes into a table,
 * written to storage/logs/load-budget.md after each row and printed at the end of the suite.
 *
 * What a run does not pay, the same for every row and so hiding nothing that grows with the data (K10): the test acts
 * with one User instance for all runs (relations it loaded stay loaded), and SESSION_DRIVER and CACHE_STORE are `array`
 * (phpunit.load.xml). A request in production reads its session row, the account and the counters of the rate limit
 * (store `retrying-database`): a few queries and a few milliseconds more per answer.
 */
final class Budget
{
    /** The budget of one answer in seconds (A187). */
    public const SECONDS = 1.5;

    /** The runs after the warm-up; the median is the middle one. */
    public const RUNS = 3;

    /** @var array<string, array{median: float, runs: list<float>, queries: list<int>, baseline: ?int, smaller: ?int, budget: ?float, memory: ?float}> */
    private static array $rows = [];

    /** @var array<string, int>|null the queries of every row in the small world, once per process */
    private static ?array $baselines = null;

    private static mixed $answer = null;

    private static int $counted = 0;

    /** The app whose queries are counted (a test boots its own app, so its listener is registered again). */
    private static ?object $listening = null;

    /**
     * Runs `$request` once to warm up, then RUNS times, and records the median of the runs and the queries of each.
     * `$baseline` and `$smaller` (the queries against 100 items and of a smaller answer) only go into the table.
     */
    public static function measure(string $name, Closure $request, float $seconds = self::SECONDS, ?int $baseline = null, ?int $smaller = null): float
    {
        self::prepare();
        self::$answer = self::answered($request());

        $runs = [];
        $queries = [];
        for ($i = 0; $i < self::RUNS; $i++) {
            self::prepare();
            $started = hrtime(true);
            $answer = $request();
            $runs[] = (hrtime(true) - $started) / 1e9;
            $queries[] = self::$counted;
            self::answered($answer);
        }

        $sorted = $runs;
        sort($sorted);
        $median = $sorted[intdiv(self::RUNS, 2)];
        self::$rows[$name] = ['median' => $median, 'runs' => $runs, 'queries' => $queries, 'baseline' => $baseline, 'smaller' => $smaller, 'budget' => $seconds, 'memory' => null];
        self::write();

        return $median;
    }

    /**
     * Runs `$work` once, without a warm-up, for work a second run would find done (a bulk change, a night, a template
     * run): records its duration, its queries and the peak of PHP's memory from its start (memory_reset_peak_usage(),
     * in MB) as a row of the table, with `$seconds` as its budget (null: only measured). Returns what `$work` returned.
     */
    public static function once(string $name, Closure $work, ?float $seconds): mixed
    {
        self::prepare();
        memory_reset_peak_usage();
        $started = hrtime(true);
        $result = $work();
        $run = (hrtime(true) - $started) / 1e9;
        $memory = memory_get_peak_usage() / 1_048_576;

        self::$rows[$name] = ['median' => $run, 'runs' => [$run], 'queries' => [self::$counted], 'baseline' => null, 'smaller' => null, 'budget' => $seconds, 'memory' => $memory];
        self::write();

        return $result;
    }

    /**
     * The queries `$request` makes after a warm-up run, with the same preparations as measure(); answer() is then what
     * the counted run returned.
     */
    public static function queries(Closure $request): int
    {
        self::prepare();
        self::answered($request());
        self::prepare();
        self::$answer = $request();
        $counted = self::$counted;
        self::answered(self::$answer);

        return $counted;
    }

    /** What the warm-up run of the last measure() returned, or the counted run of the last queries(). */
    public static function answer(): mixed
    {
        return self::$answer;
    }

    /**
     * @return array{median: float, runs: list<float>, queries: list<int>, baseline: ?int, smaller: ?int, budget: ?float, memory: ?float}
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
            sprintf('Median of %d runs after a warm-up, budget %.1f s per answer; queries per run, against 100 items per project and for a smaller answer (a smaller page, fewer children).', self::RUNS, self::SECONDS),
            'Not measured, the same for every row: the session, the account and the counters of the rate limit (array stores in the suite).',
            'A row with one run and a peak of memory ran once (Budget::once(): a bulk change, the night, a template run); its budget is its own, `–` only measured.',
            '',
            '| Row | Median ms | Runs ms | Queries | Against 100 items | Smaller answer | Peak MB | Status |',
            '|---|---:|---|---:|---:|---:|---:|---|',
        ];

        foreach (self::$rows as $name => $row) {
            $status = match (true) {
                $row['budget'] === null => '–',
                $row['median'] <= $row['budget'] => 'ok',
                isset($over[$name]) => 'over: '.$over[$name],
                default => 'OVER',
            };
            $lines[] = sprintf(
                '| %s | %.0f | %s | %s | %s | %s | %s | %s |',
                $name,
                $row['median'] * 1_000,
                implode(' / ', array_map(fn (float $run) => sprintf('%.0f', $run * 1_000), $row['runs'])),
                implode(' / ', array_unique($row['queries'])),
                $row['baseline'] ?? '–',
                $row['smaller'] ?? '–',
                $row['memory'] === null ? '–' : sprintf('%.0f', $row['memory']),
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

    /** A run that answers with a TestResponse has to answer 200; anything else goes through as it came. */
    private static function answered(mixed $answer): mixed
    {
        if ($answer instanceof TestResponse) {
            $answer->assertOk();
        }

        return $answer;
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
