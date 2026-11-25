<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/*
 * The comment whose mention of a bot werkbuch refused (WEBU-36, A711): the default bot says why at the item, at most
 * once for each comment. The unique index holds that; no foreign key (a comment and its note go together with their
 * item, and a set null within one cascade over the same table InnoDB may refuse).
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('comments', function (Blueprint $table) {
            $table->ulid('refused_comment_id')->nullable()->after('run_id')->unique();
        });
    }

    public function down(): void
    {
        Schema::table('comments', function (Blueprint $table) {
            $table->dropUnique(['refused_comment_id']);
            $table->dropColumn('refused_comment_id');
        });
    }
};
