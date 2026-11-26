<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

// The times of runs with microseconds, like comments and events: the activity mixes runs, comments and history by
// their moment, and a run and a change of the same second must read in the order they happened.
return new class extends Migration
{
    public function up(): void
    {
        $this->precision(6);
    }

    public function down(): void
    {
        $this->precision(0);
    }

    private function precision(int $digits): void
    {
        Schema::table('agent_runs', function (Blueprint $table) use ($digits) {
            $table->timestamp('created_at', $digits)->nullable()->change();
            $table->timestamp('updated_at', $digits)->nullable()->change();
        });
    }
};
