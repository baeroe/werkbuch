<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

// The tidying up finds the deliveries that wait since long (their job got lost, K15) by status and creation time,
// without reading the whole log; the foreign key of `webhook_id` stays on its own index.
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('webhook_deliveries', fn (Blueprint $table) => $table->index(['status', 'created_at']));
    }

    public function down(): void
    {
        Schema::table('webhook_deliveries', fn (Blueprint $table) => $table->dropIndex(['status', 'created_at']));
    }
};
