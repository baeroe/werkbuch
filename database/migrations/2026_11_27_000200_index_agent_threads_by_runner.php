<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

// the claim of a runner names the strands that ended on it (WEBU-61)
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('agent_threads', function (Blueprint $table) {
            $table->index(['runner_id', 'status', 'updated_at']);
        });
    }

    public function down(): void
    {
        // InnoDB dropped the index the foreign key made for itself once this one could carry it: bring it back first
        if (! Schema::hasIndex('agent_threads', ['runner_id'])) {
            Schema::table('agent_threads', fn (Blueprint $table) => $table->index('runner_id', 'agent_threads_runner_id_foreign'));
        }

        Schema::table('agent_threads', function (Blueprint $table) {
            $table->dropIndex(['runner_id', 'status', 'updated_at']);
        });
    }
};
