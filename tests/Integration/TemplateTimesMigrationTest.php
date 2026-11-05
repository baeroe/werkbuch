<?php

use App\Models\Template;
use Illuminate\Support\Facades\DB;

/*
 * The migration 2026_11_05_001310_add_microseconds_to_template_times, rolled back and run again on the migrations of
 * the test (K4 of phase 5): the times of templates keep their microseconds, so a run tells a save of the same second
 * from the version it prepared (K16).
 */

const TEMPLATE_TIMES_MIGRATION = 'database/migrations/2026_11_05_001310_add_microseconds_to_template_times.php';

it('gives the times of templates microseconds and takes them away again', function () {
    $precision = fn () => DB::table('information_schema.COLUMNS')
        ->where('TABLE_SCHEMA', DB::getDatabaseName())->where('TABLE_NAME', 'templates')
        ->whereIn('COLUMN_NAME', ['created_at', 'updated_at'])
        ->orderBy('COLUMN_NAME')->pluck('DATETIME_PRECISION', 'COLUMN_NAME')->map(fn ($digits) => (int) $digits)->all();

    expect($precision())->toBe(['created_at' => 6, 'updated_at' => 6]);

    foreach ([1, 2] as $round) {
        $template = Template::factory()->create(['updated_at' => '2026-11-02 10:00:00.250000']);
        $this->artisan('migrate:rollback', ['--path' => TEMPLATE_TIMES_MIGRATION])->assertSuccessful();
        expect($precision())->toBe(['created_at' => 0, 'updated_at' => 0], "rolled back, round {$round}")
            ->and((string) DB::table('templates')->where('id', $template->id)->value('updated_at'))->toBe('2026-11-02 10:00:00');

        $this->artisan('migrate')->assertSuccessful();
        expect($precision())->toBe(['created_at' => 6, 'updated_at' => 6], "migrated, round {$round}");
    }
});
