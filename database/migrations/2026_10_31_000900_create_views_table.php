<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

// Views of the team (spec 4.11): a name (not unique), a Lucide icon or one emoji, the filter and the display in their
// normal form (FilterSchema, DisplaySchema). Favorites point to a view polymorphically (`favoritable_type = 'view'`,
// no foreign key); DeleteView takes them away in its transaction.
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('views', function (Blueprint $table) {
            $table->ulid('id')->primary();
            $table->string('name', 60)->index();
            $table->string('icon', 32);
            $table->json('filter');
            $table->json('display');
            $table->foreignUlid('created_by')->constrained('users')->restrictOnDelete();
            $table->timestamps();
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('views');
    }
};
