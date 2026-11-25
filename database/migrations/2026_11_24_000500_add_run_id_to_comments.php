<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/*
 * The run a comment of a bot answers (spec 10.6, WEBU-28, A643): the results of `review` and `comment`, the summary of
 * a run without a repo, a run that failed and a strand that pauses after a run that changed nothing are comments of the
 * bot; the comment names the run, the item links its card. A run that goes leaves the comment without it.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('comments', function (Blueprint $table) {
            $table->foreignUlid('run_id')->nullable()->after('author_id')->constrained('agent_runs')->nullOnDelete();
        });
    }

    public function down(): void
    {
        Schema::table('comments', function (Blueprint $table) {
            $table->dropConstrainedForeignId('run_id');
        });
    }
};
