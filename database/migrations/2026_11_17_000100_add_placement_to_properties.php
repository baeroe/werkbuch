<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/*
 * Where a property shows on an item (WEBU-6): `sidebar` or `body`. Rich text goes below the description, as a new one
 * would; every other property stays in the side panel. No event and no `updated_at`: the catalog keeps its history.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('properties', function (Blueprint $table) {
            $table->string('placement', 16)->default('sidebar')->after('help');
        });

        DB::table('properties')->where('field_type', 'rich_text')->update(['placement' => 'body']);
    }

    public function down(): void
    {
        Schema::table('properties', function (Blueprint $table) {
            $table->dropColumn('placement');
        });
    }
};
