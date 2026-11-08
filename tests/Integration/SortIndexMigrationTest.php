<?php

use Illuminate\Support\Facades\Schema;

/*
 * The migration 2026_11_08_000300_add_sort_index_to_work_item_values, rolled back and run again on the migrations of
 * the test (DatabaseMigrations, K4): the index of the sort by a property goes and comes back, and the foreign key of
 * `property_id` keeps an index of its own.
 */

const SORT_INDEX_MIGRATION = 'database/migrations/2026_11_08_000300_add_sort_index_to_work_item_values.php';

it('adds the index of the sort by a property and takes it away again', function () {
    $index = fn () => Schema::hasIndex('work_item_values', 'work_item_values_sort_index');

    expect($index())->toBeTrue();

    foreach ([1, 2] as $round) {
        $this->artisan('migrate:rollback', ['--path' => SORT_INDEX_MIGRATION])->assertSuccessful();
        expect($index())->toBeFalse("rolled back, round {$round}")
            ->and(Schema::hasIndex('work_item_values', ['property_id', 'value_option_id']))->toBeTrue();

        $this->artisan('migrate')->assertSuccessful();
        expect($index())->toBeTrue("migrated, round {$round}");
    }
});
