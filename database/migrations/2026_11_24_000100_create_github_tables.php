<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * The one GitHub app of the instance (spec 4, 10.2, 11.3, WEBU-24): the app from the manifest flow (its private key and
 * webhook secret encrypted with APP_KEY), its installations and the repos they reach, the repo of a project (1:1, both
 * sides unique) with the guard against an unauthorized merge, the merges werkbuch made itself and the webhook deliveries
 * (deduplicated by the delivery ID).
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('github_apps', function (Blueprint $table) {
            $table->ulid('id')->primary();
            // one row at most: a second insert breaks the unique index
            $table->unsignedTinyInteger('singleton')->default(1)->unique();
            $table->unsignedBigInteger('app_id');
            $table->string('slug', 100);
            $table->string('name', 100);
            $table->string('client_id', 100)->nullable();
            $table->string('owner_login', 100);
            $table->string('owner_type', 20);
            $table->string('html_url', 255);
            $table->text('private_key');
            $table->text('webhook_secret');
            $table->json('permissions');
            $table->json('events');
            $table->foreignUlid('created_by')->constrained('users')->restrictOnDelete();
            $table->timestamps();
        });

        Schema::create('github_installations', function (Blueprint $table) {
            $table->ulid('id')->primary();
            $table->unsignedBigInteger('installation_id')->unique();
            $table->string('account_login', 100);
            $table->string('account_type', 20);
            $table->string('repository_selection', 20);
            $table->timestamp('suspended_at')->nullable();
            // gone at GitHub (uninstalled): the row stays, its repos are removed (A512)
            $table->timestamp('removed_at')->nullable();
            $table->timestamps();
        });

        Schema::create('github_repositories', function (Blueprint $table) {
            $table->ulid('id')->primary();
            $table->foreignUlid('installation_id')->constrained('github_installations')->cascadeOnDelete();
            $table->unsignedBigInteger('github_id')->unique();
            $table->string('full_name', 200);
            $table->boolean('private');
            $table->string('default_branch', 255);
            $table->string('html_url', 255);
            $table->timestamp('removed_at')->nullable();
            $table->timestamps();
            $table->index('full_name');
        });

        Schema::create('project_repositories', function (Blueprint $table) {
            $table->ulid('id')->primary();
            $table->foreignUlid('project_id')->unique()->constrained()->cascadeOnDelete();
            $table->foreignUlid('repository_id')->unique()->constrained('github_repositories')->cascadeOnDelete();
            $table->string('base_branch', 255);
            // whether a ruleset protects the base branch (only shown, spec 10.2); null: not known (GitHub did not answer)
            $table->boolean('protected')->nullable();
            $table->timestamp('protected_checked_at')->nullable();
            // the guard against an unauthorized merge (spec 11.3): set by a push of the app nobody explains
            $table->timestamp('guard_detected_at')->nullable();
            $table->string('guard_sha', 64)->nullable();
            $table->string('guard_branch', 255)->nullable();
            // the runs werkbuch takes for the push: `[{run_id, item_id, bot_id}]`, empty when it found none
            $table->json('guard_runs')->nullable();
            $table->timestamps();
        });

        Schema::create('github_merges', function (Blueprint $table) {
            $table->ulid('id')->primary();
            $table->foreignUlid('repository_id')->constrained('github_repositories')->cascadeOnDelete();
            $table->unsignedInteger('pr_number');
            $table->string('merge_sha', 64)->nullable();
            $table->timestamp('started_at');
            $table->timestamp('merged_at')->nullable();
            $table->index(['repository_id', 'merge_sha']);
        });

        Schema::create('github_deliveries', function (Blueprint $table) {
            $table->ulid('id')->primary();
            $table->string('delivery_id', 100)->unique();
            $table->string('event', 64);
            $table->string('action', 64)->nullable();
            // GitHub sends up to 25 MB (spec 11.4)
            $table->longText('payload');
            $table->timestamp('received_at');
            $table->timestamp('processed_at')->nullable();
            $table->string('outcome', 32)->nullable();
            $table->index('received_at');
        });

        // a run GitHub gave no token for because it did not answer waits until then (A511)
        Schema::table('agent_runs', function (Blueprint $table) {
            $table->timestamp('retry_at')->nullable()->after('lease_expires_at');
        });
    }

    public function down(): void
    {
        Schema::table('agent_runs', function (Blueprint $table) {
            $table->dropColumn('retry_at');
        });
        Schema::dropIfExists('github_deliveries');
        Schema::dropIfExists('github_merges');
        Schema::dropIfExists('project_repositories');
        Schema::dropIfExists('github_repositories');
        Schema::dropIfExists('github_installations');
        Schema::dropIfExists('github_apps');
    }
};
