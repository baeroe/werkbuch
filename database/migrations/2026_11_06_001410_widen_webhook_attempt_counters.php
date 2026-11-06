<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

// "Send again" has no limit but its throttle, so the number of attempts of a delivery outgrows a tinyint (T2-M2): a
// small integer holds 65 535 (A367). Going back cuts the numbers to 255 first.
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('webhook_deliveries', fn (Blueprint $table) => $table->unsignedSmallInteger('attempts')->default(0)->change());
        Schema::table('webhook_attempts', fn (Blueprint $table) => $table->unsignedSmallInteger('attempt')->change());
    }

    public function down(): void
    {
        DB::table('webhook_deliveries')->where('attempts', '>', 255)->update(['attempts' => 255]);
        DB::table('webhook_attempts')->where('attempt', '>', 255)->update(['attempt' => 255]);
        Schema::table('webhook_deliveries', fn (Blueprint $table) => $table->unsignedTinyInteger('attempts')->default(0)->change());
        Schema::table('webhook_attempts', fn (Blueprint $table) => $table->unsignedTinyInteger('attempt')->change());
    }
};
