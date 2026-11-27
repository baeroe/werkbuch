<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

// the usage of the Claude subscription a runner reports, and the limit from which it takes no new runs (WEBU-65)
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('runners', function (Blueprint $table) {
            $table->json('usage')->nullable()->after('equipment');
            $table->unsignedTinyInteger('usage_limit')->nullable()->after('slots_light');
        });
    }

    public function down(): void
    {
        Schema::table('runners', function (Blueprint $table) {
            $table->dropColumn(['usage', 'usage_limit']);
        });
    }
};
