<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

// Bots (default bot, owner, description) and two-factor sign-in (A6).
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('users', function (Blueprint $table) {
            $table->boolean('is_default_bot')->default(false)->index()->after('handle');
            $table->foreignUlid('owner_id')->nullable()->after('is_default_bot')->constrained('users')->nullOnDelete();
            $table->string('description', 500)->nullable()->after('owner_id');
            $table->text('two_factor_secret')->nullable()->after('password');
            $table->text('two_factor_recovery_codes')->nullable()->after('two_factor_secret');
            $table->timestamp('two_factor_confirmed_at')->nullable()->after('two_factor_recovery_codes');
        });
    }

    public function down(): void
    {
        Schema::table('users', function (Blueprint $table) {
            $table->dropForeign(['owner_id']);
            $table->dropIndex(['is_default_bot']);
            $table->dropColumn([
                'is_default_bot', 'owner_id', 'description',
                'two_factor_secret', 'two_factor_recovery_codes', 'two_factor_confirmed_at',
            ]);
        });
    }
};
