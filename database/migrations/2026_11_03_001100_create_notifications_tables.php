<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

// Notifications (spec 4.14, phase plan 8 "Datenmodell"). `notification_mails` collects the mail lines of a person per
// item (`scope` `item:<ulid>`) or per day of reminders (`due:<Y-m-d>`); `open_key` (`<user_id>:<scope>`) is set while
// the collection is open and decides which of two consumers opens it (unique; null once it is sent). `notifications`
// holds one row per person and event or reminder (`dedupe_key` `event:<id>` or `due:<item>:<day>`, unique per person:
// a second delivery of the same event writes nothing); `inbox` says whether the row shows in the inbox (A271), a row
// only for mail has it off. `project_id` is null only for organization notifications (`webhook_disabled`, K5); rows go
// with their project and item (A286), accounts are never deleted. `notification_preferences` keeps the choices of a
// person per kind and channel; a missing row is the default (App\Domain\Notifications\Preferences).
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('notification_mails', function (Blueprint $table) {
            $table->ulid('id')->primary();
            $table->foreignUlid('user_id')->constrained()->restrictOnDelete();
            $table->string('scope', 80);
            $table->string('open_key', 120)->nullable()->unique();
            $table->timestamp('due_at');
            $table->timestamp('sent_at')->nullable();
            $table->string('outcome', 16)->nullable();
            $table->timestamps();

            // the sweeper: collections not sent whose time has come
            $table->index(['sent_at', 'due_at']);
        });

        Schema::create('notifications', function (Blueprint $table) {
            $table->ulid('id')->primary();
            $table->foreignUlid('user_id')->constrained()->restrictOnDelete();
            $table->string('kind', 32);
            $table->foreignUlid('event_id')->nullable()->constrained()->nullOnDelete();
            $table->foreignUlid('project_id')->nullable()->constrained()->cascadeOnDelete();
            $table->foreignUlid('work_item_id')->nullable()->constrained()->cascadeOnDelete();
            $table->foreignUlid('actor_id')->nullable()->constrained('users')->restrictOnDelete();
            $table->json('data');
            $table->boolean('inbox');
            $table->foreignUlid('mail_id')->nullable()->constrained('notification_mails')->nullOnDelete();
            $table->string('dedupe_key', 120);
            $table->timestamp('read_at', 6)->nullable();
            $table->timestamps(6);

            $table->unique(['user_id', 'dedupe_key']);
            // the inbox, newest first, and the badge
            $table->index(['user_id', 'inbox', 'created_at', 'id']);
            $table->index(['user_id', 'read_at']);
            // pruning read notifications
            $table->index('read_at');
        });

        Schema::create('notification_preferences', function (Blueprint $table) {
            $table->ulid('id')->primary();
            $table->foreignUlid('user_id')->constrained()->cascadeOnDelete();
            $table->string('kind', 32);
            $table->string('channel', 8);
            $table->boolean('enabled');
            $table->timestamps();

            $table->unique(['user_id', 'kind', 'channel']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('notification_preferences');
        Schema::dropIfExists('notifications');
        Schema::dropIfExists('notification_mails');
    }
};
