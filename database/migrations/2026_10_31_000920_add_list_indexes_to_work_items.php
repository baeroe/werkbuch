<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

// Indexes for lists (Phase 5): the archive rule of every list, the days and times lists sort and filter by, the items
// a person created (`created_by`, then the ULID of the order), and the values of a property (yes or no filters, the
// first value of a sort).
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('work_items', function (Blueprint $table) {
            $table->index('archived_at');
            $table->index('due_date');
            $table->index('start_date');
            $table->index('created_at');
            $table->index('updated_at');
            $table->index('closed_at');
            $table->index(['created_by', 'id']);
        });

        Schema::table('work_item_values', function (Blueprint $table) {
            $table->index(['property_id', 'value_bool']);
            $table->index(['property_id', 'work_item_id']);
        });
    }

    public function down(): void
    {
        Schema::table('work_item_values', function (Blueprint $table) {
            $table->dropIndex(['property_id', 'value_bool']);
            $table->dropIndex(['property_id', 'work_item_id']);
        });

        // InnoDB drops the index it made for a foreign key once another index can serve it, as (`created_by`, `id`)
        // does: it comes back before that one goes
        $restore = ! Schema::hasIndex('work_items', 'work_items_created_by_foreign');
        Schema::table('work_items', function (Blueprint $table) use ($restore) {
            if ($restore) {
                $table->index('created_by', 'work_items_created_by_foreign');
            }
            $table->dropIndex(['archived_at']);
            $table->dropIndex(['due_date']);
            $table->dropIndex(['start_date']);
            $table->dropIndex(['created_at']);
            $table->dropIndex(['updated_at']);
            $table->dropIndex(['closed_at']);
            $table->dropIndex(['created_by', 'id']);
        });
    }
};
