<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

// PR links (spec 12, WEBU-25): a PR in the repo of a project linked to one of its items (`work_item_links`, one row per
// item, repo and number, the PR as the last webhook told it), the check runs on its head commit
// (`work_item_link_checks`, per link and check run) and the one comment of werkbuch at a PR
// (`github_pull_request_comments`). The repo is named by GitHub's ID and its name, without a foreign key: a link outlives
// a disconnected app as a relation outlives its type's label.
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('work_item_links', function (Blueprint $table) {
            $table->ulid('id')->primary();
            $table->foreignUlid('work_item_id')->constrained()->cascadeOnDelete();
            $table->string('kind', 16);
            $table->unsignedBigInteger('repository_github_id');
            $table->string('repository', 200);
            $table->unsignedInteger('number');
            $table->string('title', 512);
            $table->string('url', 2048);
            $table->string('state', 8);
            $table->boolean('draft');
            $table->string('head_branch', 255);
            $table->string('base_branch', 255);
            $table->char('head_sha', 40);
            $table->boolean('closes');
            $table->string('author', 100);
            $table->foreignUlid('thread_id')->nullable()->constrained('agent_threads')->nullOnDelete();
            $table->string('review', 16)->nullable();
            $table->char('review_sha', 40)->nullable();
            $table->timestamp('merged_at')->nullable();
            $table->timestamp('closed_at')->nullable();
            // `updated_at` of the PR in the delivery the link holds: an older delivery writes no field
            $table->timestamp('pr_updated_at')->nullable();
            // when werkbuch learned that the PR was merged (its own clock, to compare with the events of the item)
            $table->timestamp('merged_seen_at', 6)->nullable();
            $table->timestamps();

            $table->unique(['work_item_id', 'repository_github_id', 'number']);
            $table->index(['repository_github_id', 'number']);
            $table->index(['repository_github_id', 'head_sha']);
        });

        Schema::create('work_item_link_checks', function (Blueprint $table) {
            $table->ulid('id')->primary();
            $table->foreignUlid('work_item_link_id')->constrained()->cascadeOnDelete();
            $table->unsignedBigInteger('check_run_id');
            $table->string('name', 255);
            $table->string('app', 100)->nullable();
            $table->string('status', 16);
            $table->string('conclusion', 20)->nullable();
            $table->string('url', 2048)->nullable();
            $table->char('head_sha', 40);
            $table->timestamps();

            $table->unique(['work_item_link_id', 'check_run_id']);
        });

        // the repo a strand works in (WEBU-26 sets it): only a strand of the repo of the PR makes it an agent's
        Schema::table('agent_threads', function (Blueprint $table) {
            $table->unsignedBigInteger('repository_github_id')->nullable()->after('runner_id');
            $table->index(['repository_github_id', 'pr_number']);
        });

        Schema::create('github_pull_request_comments', function (Blueprint $table) {
            $table->ulid('id')->primary();
            $table->unsignedBigInteger('repository_github_id');
            $table->unsignedInteger('number');
            $table->unsignedBigInteger('comment_id')->nullable();
            $table->char('body_hash', 64)->nullable();
            $table->timestamps();

            $table->unique(['repository_github_id', 'number']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('github_pull_request_comments');
        Schema::table('agent_threads', function (Blueprint $table) {
            $table->dropIndex(['repository_github_id', 'pr_number']);
            $table->dropColumn('repository_github_id');
        });
        Schema::dropIfExists('work_item_link_checks');
        Schema::dropIfExists('work_item_links');
    }
};
