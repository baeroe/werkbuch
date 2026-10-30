<?php

use App\Enums\Locale;
use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;
use Illuminate\Support\Str;

// The organization is exactly one row (Spec 7.3). The migration creates it from the config; setup never has to.
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('organization', function (Blueprint $table) {
            $table->ulid('id')->primary();
            $table->string('name', 120);
            $table->string('locale', 2);
            $table->string('timezone', 64);
            $table->unsignedTinyInteger('week_start');
            $table->timestamps();
        });

        DB::table('organization')->insert([
            'id' => strtolower((string) Str::ulid()),
            'name' => config('app.name'),
            'locale' => (Locale::tryFrom((string) config('app.locale')) ?? Locale::En)->value,
            'timezone' => 'UTC',
            'week_start' => 1,
            'created_at' => now(),
            'updated_at' => now(),
        ]);
    }

    public function down(): void
    {
        Schema::dropIfExists('organization');
    }
};
