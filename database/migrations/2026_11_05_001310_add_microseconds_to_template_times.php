<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

// The times of templates with microseconds (K16): a run compares `updated_at` under its lock with the one it read before
// (the mark of the version it prepared), and two saves of the same second must differ. Going back cuts the fraction off.
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
        Schema::table('templates', function (Blueprint $table) use ($digits) {
            $table->timestamp('created_at', $digits)->nullable()->change();
            $table->timestamp('updated_at', $digits)->nullable()->change();
        });
    }
};
