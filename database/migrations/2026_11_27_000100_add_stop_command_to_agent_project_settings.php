<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('agent_project_settings', function (Blueprint $table) {
            $table->text('stop_command')->nullable()->after('setup_command');
        });
    }

    public function down(): void
    {
        Schema::table('agent_project_settings', function (Blueprint $table) {
            $table->dropColumn('stop_command');
        });
    }
};
