<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

// The flow of the agents (WEBU-26, spec 7). The working rules of the organization per kind of run are rows only where
// they differ from the standard werkbuch ships (a text that equals a standard is no row: a new standard reaches exactly
// the texts nobody changed). The agent settings of a project (spec 10.3) are a row per project, the defaults without
// one. A type of item tells agents how to work on it, a label may name the model of a run (`cli:model`). A strand
// keeps what the flow decides on: the head commit of its PR, the verdict of the review of a commit, the commit it
// decided to merge, since when it waits for a PR, when it asked GitHub to mark a draft ready, findings that came while a
// run of it changed code. A review of a PR names
// the PR. A link knows since when its head commit stands (a PR without checks is green two minutes after the push).
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('agent_rules', function (Blueprint $table) {
            $table->ulid('id')->primary();
            $table->string('type', 16)->unique();
            $table->mediumText('body');
            $table->foreignUlid('updated_by')->constrained('users')->restrictOnDelete();
            $table->timestamps();
        });

        Schema::create('agent_project_settings', function (Blueprint $table) {
            $table->ulid('id')->primary();
            $table->foreignUlid('project_id')->unique()->constrained()->cascadeOnDelete();
            $table->foreignUlid('review_bot_id')->nullable()->constrained('users')->restrictOnDelete();
            $table->mediumText('instructions')->nullable();
            $table->json('models');
            $table->unsignedTinyInteger('max_corrections');
            $table->unsignedTinyInteger('max_conflicts');
            $table->boolean('review_person_prs');
            $table->boolean('comment_on_pr');
            $table->string('merge_method', 8);
            $table->text('setup_command')->nullable();
            $table->text('teardown_command')->nullable();
            $table->timestamps();
        });

        Schema::table('work_item_types', function (Blueprint $table) {
            $table->text('agent_guidance')->nullable()->after('description');
        });

        Schema::table('labels', function (Blueprint $table) {
            $table->string('agent_model', 48)->nullable()->after('color');
        });

        Schema::table('agent_threads', function (Blueprint $table) {
            $table->string('head_sha', 64)->nullable()->after('pr_number');
            $table->boolean('pr_draft')->default(false)->after('head_sha');
            $table->string('review_sha', 64)->nullable()->after('pr_draft');
            $table->string('review_verdict', 8)->nullable()->after('review_sha');
            $table->string('merge_sha', 64)->nullable()->after('review_verdict');
            $table->timestamp('awaiting_pr_since')->nullable()->after('merge_sha');
            $table->timestamp('ready_requested_at')->nullable()->after('awaiting_pr_since');
            // findings of CI or a review that came while a run of the strand changed code (A607)
            $table->json('pending_findings')->nullable()->after('ready_requested_at');
            // a commit a run reported that the PR does not have yet, and when (A610: the sweep looks after a while)
            $table->string('pushed_sha', 64)->nullable()->after('pending_findings');
            $table->timestamp('pushed_at')->nullable()->after('pushed_sha');
        });

        Schema::table('agent_runs', function (Blueprint $table) {
            $table->unsignedBigInteger('repository_github_id')->nullable()->after('head_sha');
            $table->unsignedInteger('pr_number')->nullable()->after('repository_github_id');
            // a review once per head commit of a PR
            $table->index(['repository_github_id', 'pr_number', 'head_sha']);
        });

        Schema::table('work_item_links', function (Blueprint $table) {
            $table->timestamp('head_seen_at')->nullable()->after('head_sha');
            // the head commit whose check runs werkbuch last read from GitHub itself, and when (A591)
            $table->string('checks_loaded_sha', 40)->nullable()->after('head_seen_at');
            $table->timestamp('checks_loaded_at')->nullable()->after('checks_loaded_sha');
        });

        // besides check runs a link keeps the workflow runs and commit statuses of its head commit (A608); the new unique
        // index comes first, so that the foreign key of the link always has an index to stand on
        Schema::table('work_item_link_checks', function (Blueprint $table) {
            $table->string('kind', 8)->default('check')->after('work_item_link_id');
            $table->unique(['work_item_link_id', 'kind', 'check_run_id']);
        });
        Schema::table('work_item_link_checks', function (Blueprint $table) {
            $table->dropUnique(['work_item_link_id', 'check_run_id']);
        });
    }

    public function down(): void
    {
        // the rows of workflow runs and statuses go first: their IDs may meet those of check runs under the old index
        DB::table('work_item_link_checks')->whereIn('kind', ['workflow', 'status'])->delete();
        Schema::table('work_item_link_checks', function (Blueprint $table) {
            $table->unique(['work_item_link_id', 'check_run_id']);
        });
        Schema::table('work_item_link_checks', function (Blueprint $table) {
            $table->dropUnique(['work_item_link_id', 'kind', 'check_run_id']);
            $table->dropColumn('kind');
        });

        Schema::table('work_item_links', function (Blueprint $table) {
            $table->dropColumn(['head_seen_at', 'checks_loaded_sha', 'checks_loaded_at']);
        });

        Schema::table('agent_runs', function (Blueprint $table) {
            $table->dropIndex(['repository_github_id', 'pr_number', 'head_sha']);
            $table->dropColumn(['repository_github_id', 'pr_number']);
        });

        Schema::table('agent_threads', function (Blueprint $table) {
            $table->dropColumn(['head_sha', 'pr_draft', 'review_sha', 'review_verdict', 'merge_sha', 'awaiting_pr_since', 'ready_requested_at', 'pending_findings', 'pushed_sha', 'pushed_at']);
        });

        Schema::table('labels', function (Blueprint $table) {
            $table->dropColumn('agent_model');
        });

        Schema::table('work_item_types', function (Blueprint $table) {
            $table->dropColumn('agent_guidance');
        });

        Schema::dropIfExists('agent_project_settings');
        Schema::dropIfExists('agent_rules');
    }
};
