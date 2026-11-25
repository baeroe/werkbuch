<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/*
 * The mark at a comment whose mention of an agent werkbuch refused (WEBU-36, A711): the default bot said why at the
 * item, at most once for each comment. The mark stands at the row of the asking comment, which the note locks `for
 * update` anyway: no index and no locking read of a key that is not there yet (a gap lock that notes at other items
 * would share).
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('comments', function (Blueprint $table) {
            $table->timestamp('refusal_noted_at', 6)->nullable()->after('run_id');
        });
    }

    public function down(): void
    {
        Schema::table('comments', function (Blueprint $table) {
            $table->dropColumn('refusal_noted_at');
        });
    }
};
