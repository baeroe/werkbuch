<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

// Comments of work items (spec 4.10) and their reactions. A comment goes with its item (cascade), its author stays
// (accounts are never deleted). `body` is the Tiptap JSON, `body_text` its plain text (search, Phase 7 Task 12);
// `edited_at` marks a changed comment. A reaction is one person's emoji on a comment, once per person and emoji; the
// emoji compares byte by byte (`utf8mb4_bin`, P14): 👍 and 👍🏽 are two reactions, the default collation would make them one.
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('comments', function (Blueprint $table) {
            $table->ulid('id')->primary();
            $table->foreignUlid('work_item_id')->constrained()->cascadeOnDelete();
            $table->foreignUlid('author_id')->constrained('users')->restrictOnDelete();
            $table->json('body');
            $table->mediumText('body_text');
            $table->timestamp('edited_at')->nullable();
            $table->timestamps();

            // the comments of an item, oldest first (ListComments)
            $table->index(['work_item_id', 'created_at', 'id']);
        });

        Schema::create('comment_reactions', function (Blueprint $table) {
            $table->ulid('id')->primary();
            $table->foreignUlid('comment_id')->constrained()->cascadeOnDelete();
            $table->foreignUlid('user_id')->constrained()->restrictOnDelete();
            $table->string('emoji', 64)->collation('utf8mb4_bin');
            $table->timestamps();

            $table->unique(['comment_id', 'user_id', 'emoji']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('comment_reactions');
        Schema::dropIfExists('comments');
    }
};
