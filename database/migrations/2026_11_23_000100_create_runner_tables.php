<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

// Runners, agents and their runs (WEBU-20, spec 5, 6, 7.5, 8, 9, 11.2). A runner is a machine of the organization with
// a token of its own (only its hash), the places werkbuch sets and the last report it sent (load, CLIs, equipment); a
// revoked runner stays as a row, its runs name it. A pairing code is a one-time code (only its hash) a runner redeems
// for its token. An agent configuration belongs to a bot. A strand (`agent_threads`) is the work on one item or epic; a
// run (`agent_runs`) is one run of an agent, of a project always, of an item mostly (a review of a PR without an item has
// none); its events are the log the runner sends. A run token is a personal access token of the bot that names its run.
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('runners', function (Blueprint $table) {
            $table->ulid('id')->primary();
            $table->string('name', 64);
            $table->char('token_hash', 64)->unique();
            $table->string('os', 16);
            $table->string('arch', 16);
            $table->string('version', 32);
            $table->unsignedSmallInteger('protocol');
            $table->unsignedTinyInteger('slots_total');
            $table->unsignedTinyInteger('slots_per_repo');
            $table->unsignedTinyInteger('slots_light');
            $table->json('load')->nullable();
            $table->json('clis');
            $table->json('equipment')->nullable();
            $table->timestamp('last_seen_at')->nullable();
            $table->timestamp('revoked_at')->nullable();
            $table->foreignUlid('created_by')->constrained('users')->restrictOnDelete();
            $table->timestamps();

            $table->index(['revoked_at', 'name']);
        });

        Schema::create('runner_pairing_codes', function (Blueprint $table) {
            $table->ulid('id')->primary();
            $table->char('code_hash', 64)->unique();
            $table->timestamp('expires_at');
            $table->timestamp('redeemed_at')->nullable();
            $table->foreignUlid('runner_id')->nullable()->constrained()->nullOnDelete();
            $table->foreignUlid('created_by')->constrained('users')->restrictOnDelete();
            $table->timestamp('created_at')->nullable();
        });

        Schema::create('agent_configs', function (Blueprint $table) {
            $table->ulid('id')->primary();
            $table->foreignUlid('bot_id')->unique()->constrained('users')->cascadeOnDelete();
            $table->boolean('enabled');
            $table->json('runner_ids');
            $table->string('cli', 16);
            $table->string('model', 32);
            $table->json('models');
            $table->timestamps();
        });

        Schema::create('agent_threads', function (Blueprint $table) {
            $table->ulid('id')->primary();
            $table->foreignUlid('bot_id')->constrained('users')->restrictOnDelete();
            $table->foreignUlid('project_id')->constrained()->cascadeOnDelete();
            $table->foreignUlid('work_item_id')->nullable()->constrained()->cascadeOnDelete();
            $table->foreignUlid('runner_id')->nullable()->constrained()->nullOnDelete();
            $table->string('branch')->nullable();
            $table->string('base_branch')->nullable();
            $table->string('worktree')->nullable();
            $table->string('session_id', 200)->nullable();
            $table->unsignedInteger('pr_number')->nullable();
            $table->string('status', 16);
            $table->string('pause_reason', 32)->nullable();
            $table->unsignedTinyInteger('corrections')->default(0);
            $table->unsignedTinyInteger('conflicts')->default(0);
            $table->timestamps();
        });

        Schema::create('agent_runs', function (Blueprint $table) {
            $table->ulid('id')->primary();
            $table->string('type', 16);
            $table->string('status', 16);
            $table->string('waiting_reason', 32)->nullable();
            $table->foreignUlid('bot_id')->constrained('users')->restrictOnDelete();
            $table->string('cli', 16);
            $table->string('model', 32);
            $table->string('model_source', 16);
            $table->foreignUlid('model_label_id')->nullable()->constrained('labels')->nullOnDelete();
            $table->foreignUlid('runner_id')->nullable()->constrained()->nullOnDelete();
            $table->foreignUlid('project_id')->constrained()->cascadeOnDelete();
            $table->foreignUlid('work_item_id')->nullable()->constrained()->nullOnDelete();
            $table->foreignUlid('thread_id')->nullable()->constrained('agent_threads')->nullOnDelete();
            $table->string('head_sha', 64)->nullable();
            $table->ulid('trigger_event_id')->nullable();
            $table->json('context');
            $table->unsignedTinyInteger('attempt')->default(1);
            $table->timestamp('lease_expires_at')->nullable();
            $table->timestamp('started_at')->nullable();
            $table->timestamp('finished_at')->nullable();
            $table->json('result')->nullable();
            $table->string('session_id', 200)->nullable();
            $table->json('usage')->nullable();
            $table->string('error', 500)->nullable();
            $table->foreignUlid('canceled_by')->nullable()->constrained('users')->restrictOnDelete();
            $table->unsignedInteger('events_dropped')->default(0);
            $table->timestamps();

            // the runs a claim looks at (pending ones) and the reaper (busy ones past their lease)
            $table->index(['status', 'type']);
            // what runs on a runner (its places) and the runs of a runner page
            $table->index(['runner_id', 'status']);
            // whether a strand runs (a claim reads it under the lock of the strand, locking only the busy runs, A488)
            $table->index(['thread_id', 'status']);
        });

        Schema::create('agent_run_events', function (Blueprint $table) {
            $table->ulid('id')->primary();
            $table->foreignUlid('run_id')->constrained('agent_runs')->cascadeOnDelete();
            $table->unsignedTinyInteger('attempt');
            $table->string('kind', 16);
            $table->text('text');
            $table->unsignedInteger('bytes');
            $table->timestamp('at', 6);

            // the log of a run in order; carries the foreign key of `run_id`
            $table->index(['run_id', 'id']);
            // what the pruning finds
            $table->index('at');
        });

        Schema::table('personal_access_tokens', function (Blueprint $table) {
            // a run token goes with its run (a purged project takes its runs): it never turns into a plain token of the bot
            $table->foreignUlid('agent_run_id')->nullable()->after('tokenable_id')->constrained('agent_runs')->cascadeOnDelete();
        });
    }

    public function down(): void
    {
        Schema::table('personal_access_tokens', function (Blueprint $table) {
            $table->dropConstrainedForeignId('agent_run_id');
        });
        Schema::dropIfExists('agent_run_events');
        Schema::dropIfExists('agent_runs');
        Schema::dropIfExists('agent_threads');
        Schema::dropIfExists('agent_configs');
        Schema::dropIfExists('runner_pairing_codes');
        Schema::dropIfExists('runners');
    }
};
