<?php

use App\Models\Comment;
use Illuminate\Support\Facades\DB;

/*
 * The migration 2026_11_02_001020_add_microseconds_to_comment_times, rolled back and run again on the migrations of
 * the test (DatabaseMigrations, K4): the times of comments keep their microseconds, so a comment and a change of the
 * same second read in the order they happened.
 */

const COMMENT_TIMES_MIGRATION = 'database/migrations/2026_11_02_001020_add_microseconds_to_comment_times.php';

it('gives the times of comments microseconds and takes them away again', function () {
    $precision = fn () => DB::table('information_schema.COLUMNS')
        ->where('TABLE_SCHEMA', DB::getDatabaseName())->where('TABLE_NAME', 'comments')
        ->whereIn('COLUMN_NAME', ['created_at', 'updated_at', 'edited_at'])
        ->orderBy('COLUMN_NAME')->pluck('DATETIME_PRECISION', 'COLUMN_NAME')->map(fn ($digits) => (int) $digits)->all();

    expect($precision())->toBe(['created_at' => 6, 'edited_at' => 6, 'updated_at' => 6]);

    // twice: back to whole seconds (a comment stays, its fraction goes) and forward again
    foreach ([1, 2] as $round) {
        $comment = Comment::factory()->create(['created_at' => '2026-11-02 10:00:00.250000']);
        $this->artisan('migrate:rollback', ['--path' => COMMENT_TIMES_MIGRATION])->assertSuccessful();
        expect($precision())->toBe(['created_at' => 0, 'edited_at' => 0, 'updated_at' => 0], "rolled back, round {$round}")
            ->and((string) DB::table('comments')->where('id', $comment->id)->value('created_at'))->toBe('2026-11-02 10:00:00');

        $this->artisan('migrate')->assertSuccessful();
        expect($precision())->toBe(['created_at' => 6, 'edited_at' => 6, 'updated_at' => 6], "migrated, round {$round}")
            ->and(DB::table('comments')->where('id', $comment->id)->exists())->toBeTrue();
    }
});
