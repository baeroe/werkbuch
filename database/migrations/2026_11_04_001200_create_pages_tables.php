<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

// The wiki of a project (spec 4.15, plan "Datenmodell"): a tree of pages over `parent_id` and `rank` per row of
// siblings, and the saved states of a page as versions. `rank` is ASCII compared byte by byte (`ascii_bin`, as
// `work_items.rank`); the emoji byte by byte too (`utf8mb4_bin`: 👍 and 👍🏽 are two emoji). A page goes with its project,
// a version with its page (cascade). `parent_id` is `nullOnDelete` (K1): InnoDB cascades at most 15 levels deep, a tree
// of any depth goes with its project because each page goes by its own `project_id`, and DeletePage removes the whole
// subtree itself. `content_text` is the plain text of `content` (search). Accounts are never deleted (`restrict`).
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('pages', function (Blueprint $table) {
            $table->ulid('id')->primary();
            $table->foreignUlid('project_id')->constrained()->cascadeOnDelete();
            $table->foreignUlid('parent_id')->nullable()->constrained('pages')->nullOnDelete();
            $table->string('rank', 160)->charset('ascii')->collation('ascii_bin');
            $table->string('title', 200);
            $table->string('emoji', 64)->nullable()->collation('utf8mb4_bin');
            $table->json('content')->nullable();
            $table->mediumText('content_text')->nullable();
            $table->unsignedInteger('version')->default(1);
            $table->foreignUlid('created_by')->constrained('users')->restrictOnDelete();
            $table->foreignUlid('updated_by')->constrained('users')->restrictOnDelete();
            $table->timestamps();

            // the last changed pages of a project. First on purpose: InnoDB carries the foreign key of `project_id` on
            // the first index that starts with it. Were that the index below, the `set null` of a child (its parent goes
            // with the project) would change a column of the key's index, InnoDB would check the key again against the
            // project being deleted and refuse (1452): a project with a page below another could never be deleted.
            $table->index(['project_id', 'updated_at']);
            // the siblings of a page in their order (the tree, PageRanks)
            $table->index(['project_id', 'parent_id', 'rank']);
        });

        Schema::create('page_versions', function (Blueprint $table) {
            $table->ulid('id')->primary();
            $table->foreignUlid('page_id')->constrained()->cascadeOnDelete();
            $table->unsignedInteger('version');
            $table->string('title', 200);
            $table->json('content')->nullable();
            $table->foreignUlid('author_id')->constrained('users')->restrictOnDelete();
            // the moment of the saved state: `updated_at` of the page back then
            $table->timestamp('created_at')->nullable();

            // one saved state per number (`insertOrIgnore` of a state saved twice); also the versions of a page in order
            $table->unique(['page_id', 'version']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('page_versions');
        Schema::dropIfExists('pages');
    }
};
