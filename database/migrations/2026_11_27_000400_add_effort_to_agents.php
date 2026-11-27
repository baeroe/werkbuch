<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

// the effort of a run of Claude Code, chosen like its model: label, project, bot (default and per kind), else none (WEBU-66)
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('agent_configs', function (Blueprint $table) {
            $table->string('effort', 16)->nullable()->after('models');
            $table->json('efforts')->nullable()->after('effort');
        });
        Schema::table('agent_project_settings', function (Blueprint $table) {
            $table->json('efforts')->nullable()->after('models');
        });
        Schema::table('labels', function (Blueprint $table) {
            $table->string('agent_effort', 16)->nullable()->after('agent_model');
        });
        Schema::table('agent_runs', function (Blueprint $table) {
            $table->string('effort', 16)->nullable()->after('model_label_id');
            $table->string('effort_source', 16)->nullable()->after('effort');
        });
    }

    public function down(): void
    {
        Schema::table('agent_configs', fn (Blueprint $table) => $table->dropColumn(['effort', 'efforts']));
        Schema::table('agent_project_settings', fn (Blueprint $table) => $table->dropColumn('efforts'));
        Schema::table('labels', fn (Blueprint $table) => $table->dropColumn('agent_effort'));
        Schema::table('agent_runs', fn (Blueprint $table) => $table->dropColumn(['effort', 'effort_source']));
    }
};
