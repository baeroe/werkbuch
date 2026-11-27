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
        Schema::table('agent_threads', function (Blueprint $table) {
            $table->dropIndex(['runner_id', 'status', 'updated_at']);
        });
    }
};
