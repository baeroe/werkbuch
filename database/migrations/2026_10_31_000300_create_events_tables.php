<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

// the event log: history and outbox in one (App\Events\EventRecorder writes it, App\Events\Outbox hands it on)
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('events', function (Blueprint $table) {
            $table->ulid('id')->primary();
            $table->string('type', 64)->index();
            $table->foreignUlid('actor_id')->constrained('users');
            $table->ulidMorphs('subject');
            // no foreign key: the events of a deleted project stay (P10)
            $table->ulid('project_id')->nullable()->index();
            $table->json('changes')->nullable();
            $table->json('meta');
            // microseconds keep the order of the events of one action
            $table->timestamp('occurred_at', 6)->index();
            $table->timestamp('dispatched_at')->nullable()->index();
            // the last time app:redispatch-events picked the event up; it waits 15 minutes before the next try
            $table->timestamp('redispatched_at')->nullable();
            $table->timestamps();
        });

        // one row per event and consumer: a consumer runs once per event, however often the event is dispatched
        Schema::create('event_consumptions', function (Blueprint $table) {
            $table->ulid('id')->primary();
            $table->foreignUlid('event_id')->constrained()->cascadeOnDelete();
            $table->string('consumer', 120);
            $table->timestamp('consumed_at');
            $table->timestamps();

            $table->unique(['event_id', 'consumer']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('event_consumptions');
        Schema::dropIfExists('events');
    }
};
