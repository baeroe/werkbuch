<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

// a view keeps no layout any more: each list remembers its own in the browser (WEBU-68); no event, it is no change of a view
return new class extends Migration
{
    public function up(): void
    {
        DB::table('views')->whereNotNull(DB::raw("json_value(display, '$.layout')"))->update(['display' => DB::raw("json_remove(display, '$.layout')")]);
    }

    public function down(): void
    {
        DB::table('views')->update(['display' => DB::raw("json_insert(display, '$.layout', 'list')")]);
    }
};
