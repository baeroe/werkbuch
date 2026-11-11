<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

// The database holds exactly one default bot: `default_bot_guard` is 1 for it and null for every other account, a
// virtual column (no data written, no room taken) with a unique index, which takes any number of nulls. A second
// `is_default_bot = true` fails at the index. The column is in every `select *` of `users`, so User::$hidden keeps it
// out of the array form. With two default bots already the index could not be built: the migration stops before it
// with the accounts named, so one of them can be set back by hand first.
return new class extends Migration
{
    public function up(): void
    {
        $bots = DB::table('users')->where('is_default_bot', true)->orderBy('id')->get(['id', 'handle']);
        if ($bots->count() > 1) {
            throw new RuntimeException(sprintf(
                'More than one account is the default bot: %s. Set is_default_bot = 0 on all but one of them, then migrate again.',
                $bots->map(fn (object $bot) => "{$bot->id} (@{$bot->handle})")->implode(', '),
            ));
        }

        Schema::table('users', function (Blueprint $table): void {
            $table->tinyInteger('default_bot_guard')->virtualAs('if(`is_default_bot`, 1, null)')->after('is_default_bot');
            $table->unique('default_bot_guard');
        });
    }

    public function down(): void
    {
        Schema::table('users', function (Blueprint $table): void {
            $table->dropUnique(['default_bot_guard']);
            $table->dropColumn('default_bot_guard');
        });
    }
};
