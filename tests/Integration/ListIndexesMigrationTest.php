<?php

use Illuminate\Support\Facades\Schema;

/*
 * The migration 2026_10_31_000920_add_list_indexes_to_work_items, rolled back and run again on the migrations of the
 * test (DatabaseMigrations, K4). InnoDB drops the index it made for the foreign key `created_by` once
 * (`created_by`, `id`) can serve it; going back has to bring it back, or the composite one cannot go.
 */

const LIST_INDEXES_MIGRATION = 'database/migrations/2026_10_31_000920_add_list_indexes_to_work_items.php';

it('adds the indexes of lists and takes them away again', function () {
    $indexes = fn () => [
        'archived_at' => Schema::hasIndex('work_items', ['archived_at']),
        'due_date' => Schema::hasIndex('work_items', ['due_date']),
        'start_date' => Schema::hasIndex('work_items', ['start_date']),
        'created_at' => Schema::hasIndex('work_items', ['created_at']),
        'updated_at' => Schema::hasIndex('work_items', ['updated_at']),
        'closed_at' => Schema::hasIndex('work_items', ['closed_at']),
        'created_by, id' => Schema::hasIndex('work_items', ['created_by', 'id']),
        'property_id, value_bool' => Schema::hasIndex('work_item_values', ['property_id', 'value_bool']),
        'property_id, work_item_id' => Schema::hasIndex('work_item_values', ['property_id', 'work_item_id']),
    ];
    $all = fn (bool $there) => array_fill_keys(array_keys($indexes()), $there);

    expect($indexes())->toBe($all(true));

    // twice: first with the index of the foreign key gone (as InnoDB left it), then with the one going back made
    foreach ([1, 2] as $round) {
        $this->artisan('migrate:rollback', ['--path' => LIST_INDEXES_MIGRATION])->assertSuccessful();
        expect($indexes())->toBe($all(false), "rolled back, round {$round}")
            ->and(Schema::hasIndex('work_items', ['created_by']))->toBeTrue();

        $this->artisan('migrate')->assertSuccessful();
        expect($indexes())->toBe($all(true), "migrated, round {$round}");
    }
});
