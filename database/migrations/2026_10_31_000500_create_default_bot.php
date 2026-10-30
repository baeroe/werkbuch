<?php

use App\Actions\Setup\EnsureDefaultBot;
use Illuminate\Database\Migrations\Migration;

// There always is a default bot (spec 4.2): automations and template schedules act as it. It comes after
// 2026_10_31_000400_sync_roles, because it is an org admin.
return new class extends Migration
{
    public function up(): void
    {
        EnsureDefaultBot::run();
    }

    public function down(): void
    {
        // the bot goes with the users table
    }
};
