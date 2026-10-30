<?php

use App\Actions\Setup\SyncRoles;
use Illuminate\Database\Migrations\Migration;

// The rights are fixed in code (App\Access\Grants); this mirrors them into the tables of spatie. Later changes to
// Grants ship with a migration of their own that calls SyncRoles again (or `php artisan app:sync-roles`).
return new class extends Migration
{
    public function up(): void
    {
        SyncRoles::run();
    }

    public function down(): void
    {
        // the tables go with 2026_10_31_000110_create_permission_tables
    }
};
