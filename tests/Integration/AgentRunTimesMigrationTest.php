<?php

use App\Http\Resources\AgentRunResource;
use App\Models\AgentRun;
use Illuminate\Support\Facades\DB;

/*
 * The migration 2026_11_26_000100_add_microseconds_to_agent_run_times, rolled back and run again: the times of runs
 * keep their microseconds, so a run and a comment of the same second read in the order they happened (WEBU-39).
 */

const RUN_TIMES_MIGRATION = 'database/migrations/2026_11_26_000100_add_microseconds_to_agent_run_times.php';
const RUN_TIME_COLUMNS = ['created_at', 'finished_at', 'lease_expires_at', 'started_at', 'updated_at'];

it('gives the times of runs microseconds and takes them away again', function () {
    $precision = fn () => DB::table('information_schema.COLUMNS')
        ->where('TABLE_SCHEMA', DB::getDatabaseName())->where('TABLE_NAME', 'agent_runs')
        ->whereIn('COLUMN_NAME', RUN_TIME_COLUMNS)
        ->orderBy('COLUMN_NAME')->pluck('DATETIME_PRECISION', 'COLUMN_NAME')->map(fn ($digits) => (int) $digits)->all();
    $all = fn (int $digits) => array_fill_keys(RUN_TIME_COLUMNS, $digits);

    expect($precision())->toBe($all(6));

    foreach ([1, 2] as $round) {
        $run = AgentRun::factory()->create(['created_at' => '2026-11-26 10:00:00.250000']);
        $this->artisan('migrate:rollback', ['--path' => RUN_TIMES_MIGRATION])->assertSuccessful();
        expect($precision())->toBe($all(0), "rolled back, round {$round}")
            ->and((string) DB::table('agent_runs')->where('id', $run->id)->value('created_at'))->toBe('2026-11-26 10:00:00');

        $this->artisan('migrate')->assertSuccessful();
        expect($precision())->toBe($all(6), "migrated, round {$round}")
            ->and(DB::table('agent_runs')->where('id', $run->id)->exists())->toBeTrue();
    }
});

it('gives the resource the microseconds of a run', function () {
    $run = AgentRun::factory()->create(['created_at' => '2026-11-26 10:00:00.250000']);

    expect((new AgentRunResource($run->fresh()))->resolve()['created_at'])->toBe('2026-11-26T10:00:00.250000Z');
});
