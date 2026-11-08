<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

// The sort by a property (Phase 15, Task 10a): ItemOrder joins the first value (`position` 0) of one property for every
// item of a list. This index holds the number and the day, so the join reads them from it and not from the row (50 000
// items: 135 000 pages of the index instead of 244 000 of the table). A text or an address does not fit into an index
// (`value_string` is 2048 characters) and stays a read of the row. Every other index starting with `property_id` stays,
// so the foreign key keeps an index when this one goes.
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('work_item_values', function (Blueprint $table) {
            $table->index(['property_id', 'position', 'work_item_id', 'value_number', 'value_date'], 'work_item_values_sort_index');
        });
    }

    public function down(): void
    {
        Schema::table('work_item_values', function (Blueprint $table) {
            $table->dropIndex('work_item_values_sort_index');
        });
    }
};
