<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

// The times of comments with microseconds, like `events.occurred_at`: the activity mixes comments and history by
// their moment, and a comment and a change of the same second (API, automations) must read in the order they
// happened. Going back cuts the fraction off.
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
        Schema::table('comments', function (Blueprint $table) use ($digits) {
            $table->timestamp('edited_at', $digits)->nullable()->change();
            $table->timestamp('created_at', $digits)->nullable()->change();
            $table->timestamp('updated_at', $digits)->nullable()->change();
        });
    }
};
