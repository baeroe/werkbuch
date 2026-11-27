<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

// an epic on a branch of its own, every child a strand with a PR into it (WEBU-71); strands of before stay `per_child` false
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('agent_threads', function (Blueprint $table) {
            $table->boolean('per_child')->default(false)->after('conflicts');
            $table->foreignUlid('parent_thread_id')->nullable()->after('per_child')->constrained('agent_threads')->nullOnDelete();
            $table->string('epic_waiting', 64)->nullable()->after('parent_thread_id');
        });
    }

    public function down(): void
    {
        Schema::table('agent_threads', function (Blueprint $table) {
            $table->dropConstrainedForeignId('parent_thread_id');
            $table->dropColumn(['per_child', 'epic_waiting']);
        });
    }
};
