<?php

use App\Actions\Setup\EnsureCatalog;
use Illuminate\Database\Migrations\Migration;

// The shipped catalog (spec 4.5 to 4.9): the default workflow, Task, Bug and Epic, the resolutions and the built-in
// relation types. It comes after 2026_10_31_000500_create_default_bot, because its events are the bot's.
return new class extends Migration
{
    public function up(): void
    {
        EnsureCatalog::run();
    }

    public function down(): void
    {
        // the rows go with the tables
    }
};
