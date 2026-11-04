<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

// Templates of a project with their schedule, the log of their runs and the automations of a project (spec 4.12, 4.13,
// 7.4, plan "Datenmodell"). `payload` holds the fields of the item a run creates, `schedule` the normal form of
// Schedule::toArray(); `next_run_at` is when the scheduler next looks at a template (its index), `last_run_at` the last
// scheduled term that ran and `schedule_from` since when the schedule counts (A339). The four moments of a schedule are
// `datetime`, not `timestamp`: a timestamp of MariaDB 11.4 ends in January 2038, a schedule may run until 2099 (K4); the
// session runs in UTC, so they hold UTC too. A run is unique per template and term (`scheduled_for`; null for a run by
// hand, A338, any number of them). A template, its runs and the automations go with their project (cascade); an item
// keeps itself when its template goes (`template_id` null) and a run when its item goes. Accounts are never deleted
// (`restrict`).
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('templates', function (Blueprint $table) {
            $table->ulid('id')->primary();
            $table->foreignUlid('project_id')->constrained()->cascadeOnDelete();
            $table->string('name', 120);
            $table->json('payload');
            $table->json('schedule')->nullable();
            $table->dateTime('schedule_from', 6)->nullable();
            $table->dateTime('next_run_at')->nullable();
            $table->dateTime('last_run_at')->nullable();
            $table->unsignedInteger('run_count')->default(0);
            $table->foreignUlid('created_by')->constrained('users')->restrictOnDelete();
            $table->timestamps();

            // the templates of a project by name; carries the foreign key of `project_id`
            $table->index(['project_id', 'name']);
            // what the scheduler finds due
            $table->index('next_run_at');
        });

        Schema::create('template_runs', function (Blueprint $table) {
            $table->ulid('id')->primary();
            $table->foreignUlid('template_id')->constrained()->cascadeOnDelete();
            $table->dateTime('scheduled_for')->nullable();
            $table->timestamp('ran_at', 6);
            $table->string('status', 16);
            $table->foreignUlid('work_item_id')->nullable()->constrained()->nullOnDelete();
            $table->text('error')->nullable();
            $table->foreignUlid('triggered_by')->nullable()->constrained('users')->restrictOnDelete();

            // one run per term (several runs by hand: null is never equal to null)
            $table->unique(['template_id', 'scheduled_for']);
            // the log of a template, newest first
            $table->index(['template_id', 'ran_at']);
        });

        Schema::create('automations', function (Blueprint $table) {
            $table->ulid('id')->primary();
            $table->foreignUlid('project_id')->constrained()->cascadeOnDelete();
            $table->string('key', 32);
            $table->boolean('enabled')->default(false);
            $table->json('settings');
            $table->timestamps();

            $table->unique(['project_id', 'key']);
        });

        Schema::table('work_items', function (Blueprint $table) {
            $table->foreignUlid('template_id')->nullable()->after('parent_id')->index()->constrained()->nullOnDelete();
        });
    }

    public function down(): void
    {
        Schema::table('work_items', function (Blueprint $table) {
            $table->dropConstrainedForeignId('template_id');
        });

        Schema::dropIfExists('automations');
        Schema::dropIfExists('template_runs');
        Schema::dropIfExists('templates');
    }
};
