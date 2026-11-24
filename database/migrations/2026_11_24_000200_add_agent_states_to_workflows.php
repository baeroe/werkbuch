<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

// The steps of the agents on a workflow (spec 7.4, WEBU-25): step → state id (`working`, `review`, `correction`,
// `merged`), null until an org admin names them. No foreign keys: SaveWorkflow moves or clears a step before its state
// goes.
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('workflows', function (Blueprint $table) {
            $table->json('agent_states')->nullable()->after('initial_state_id');
        });
    }

    public function down(): void
    {
        Schema::table('workflows', function (Blueprint $table) {
            $table->dropColumn('agent_states');
        });
    }
};
