<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

// Webhooks, their deliveries and the log of their attempts (spec 6.3, 7.4, plan "Datenmodell"). A webhook belongs to the
// organization (`project_id` null) or goes with its project (cascade); its secret is encrypted with APP_KEY (`text`,
// the cast writes more than the secret). `events` holds the normal form of EventPatterns::normalize, `failing_since`
// the first failure since the last success (A366, with microseconds: the disable rule counts real seconds). A delivery
// is one event × webhook (unique, so an event that arrives twice delivers once; several pings with `event_id` null)
// with its body as a snapshot (A362), its ULID is `X-Werkbuch-Delivery`; an attempt is one call of the receiver and
// carries `webhook_id` for the log of a webhook without a join. Deliveries and attempts go with their webhook (cascade).
// A bot behind a webhook and its creator are never deleted (`restrict`).
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('webhooks', function (Blueprint $table) {
            $table->ulid('id')->primary();
            $table->string('name', 120);
            $table->string('url', 2048);
            $table->text('secret');
            $table->foreignUlid('project_id')->nullable()->constrained()->cascadeOnDelete();
            $table->json('events');
            $table->foreignUlid('bot_id')->nullable()->constrained('users')->restrictOnDelete();
            $table->boolean('active');
            $table->timestamp('disabled_at')->nullable();
            $table->timestamp('failing_since', 6)->nullable();
            $table->timestamp('last_success_at')->nullable();
            $table->foreignUlid('created_by')->constrained('users')->restrictOnDelete();
            $table->timestamps();

            // the active webhooks of the organization and of one project, which the consumer reads per event
            $table->index(['active', 'project_id']);
        });

        Schema::create('webhook_deliveries', function (Blueprint $table) {
            $table->ulid('id')->primary();
            $table->foreignUlid('webhook_id')->constrained()->cascadeOnDelete();
            $table->ulid('event_id')->nullable();
            $table->string('event', 64);
            $table->mediumText('body');
            $table->string('status', 16);
            $table->unsignedTinyInteger('attempts')->default(0);
            $table->timestamp('created_at', 6)->nullable();
            $table->timestamp('updated_at')->nullable();

            // one delivery per event and webhook (null is never equal to null: any number of pings)
            $table->unique(['event_id', 'webhook_id']);
            // the deliveries of a webhook; carries the foreign key of `webhook_id`
            $table->index(['webhook_id', 'created_at']);
            // what the pruning finds (30 days after the last change)
            $table->index('updated_at');
        });

        Schema::create('webhook_attempts', function (Blueprint $table) {
            $table->ulid('id')->primary();
            $table->foreignUlid('delivery_id')->constrained('webhook_deliveries')->cascadeOnDelete();
            $table->ulid('webhook_id');
            $table->unsignedTinyInteger('attempt');
            $table->string('kind', 16);
            $table->unsignedSmallInteger('status_code')->nullable();
            $table->unsignedInteger('duration_ms');
            $table->text('response_excerpt')->nullable();
            $table->string('error', 300)->nullable();
            $table->timestamp('attempted_at', 6);

            // the log of a webhook, newest first, without a join
            $table->index(['webhook_id', 'attempted_at', 'id']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('webhook_attempts');
        Schema::dropIfExists('webhook_deliveries');
        Schema::dropIfExists('webhooks');
    }
};
