<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

// Work items with their values, labels, relations and subscribers (spec 4.4, 4.7, 4.9; plan "Datenmodell"). The key
// (`WEB-12`) is never stored: identifier of the project and `number` (P20). `rank` is ASCII compared byte by byte
// (`ascii_bin`, P4), never by the case-insensitive collation of the other texts. One value per row, a multiple choice
// as several rows with `position` 0, 1, … (P9). An option of a dropdown disappears only unused or with its property, so
// its values go with it (`cascadeOnDelete`; with `restrict` the cascade from the property could hit the option first).
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('work_items', function (Blueprint $table) {
            $table->ulid('id')->primary();
            $table->foreignUlid('project_id')->constrained()->cascadeOnDelete();
            $table->unsignedInteger('number');
            $table->foreignUlid('type_id')->constrained('work_item_types')->restrictOnDelete();
            $table->string('title', 255);
            $table->json('description')->nullable();
            $table->mediumText('description_text')->nullable();
            $table->unsignedInteger('description_version')->default(1);
            $table->foreignUlid('state_id')->constrained('workflow_states')->restrictOnDelete();
            $table->foreignUlid('resolution_id')->nullable()->constrained('resolutions')->restrictOnDelete();
            $table->foreignUlid('assignee_id')->nullable()->constrained('users')->restrictOnDelete();
            $table->string('priority', 8)->default('none');
            $table->date('start_date')->nullable();
            $table->date('due_date')->nullable();
            $table->foreignUlid('parent_id')->nullable()->constrained('work_items')->nullOnDelete();
            $table->string('rank', 128)->charset('ascii')->collation('ascii_bin');
            $table->foreignUlid('created_by')->constrained('users')->restrictOnDelete();
            $table->timestamp('started_at')->nullable();
            $table->timestamp('closed_at')->nullable();
            $table->timestamp('archived_at')->nullable();
            $table->timestamps();

            $table->unique(['project_id', 'number']);
            $table->index(['project_id', 'rank']);
            $table->index(['project_id', 'state_id']);
            $table->index('assignee_id');
            $table->index('type_id');
            $table->index('parent_id');
        });

        Schema::create('work_item_values', function (Blueprint $table) {
            $table->ulid('id')->primary();
            $table->foreignUlid('work_item_id')->constrained()->cascadeOnDelete();
            $table->foreignUlid('property_id')->constrained()->cascadeOnDelete();
            $table->unsignedSmallInteger('position');
            $table->string('value_string', 2048)->nullable();
            $table->decimal('value_number', 24, 4)->nullable();
            $table->date('value_date')->nullable();
            $table->boolean('value_bool')->nullable();
            $table->foreignUlid('value_user_id')->nullable()->constrained('users')->restrictOnDelete();
            $table->foreignUlid('value_option_id')->nullable()->constrained('property_options')->cascadeOnDelete();
            $table->json('value_json')->nullable();
            $table->timestamps();

            $table->unique(['work_item_id', 'property_id', 'position']);
            $table->index(['property_id', 'value_option_id']);
            $table->index(['property_id', 'value_user_id']);
            $table->index(['property_id', 'value_number']);
            $table->index(['property_id', 'value_date']);
        });

        Schema::create('work_item_labels', function (Blueprint $table) {
            $table->ulid('id')->primary();
            $table->foreignUlid('work_item_id')->constrained()->cascadeOnDelete();
            $table->foreignUlid('label_id')->constrained()->cascadeOnDelete();
            $table->timestamps();

            $table->unique(['work_item_id', 'label_id']);
        });

        Schema::create('work_item_relations', function (Blueprint $table) {
            $table->ulid('id')->primary();
            $table->foreignUlid('type_id')->constrained('relation_types')->cascadeOnDelete();
            $table->foreignUlid('source_id')->constrained('work_items')->cascadeOnDelete();
            $table->foreignUlid('target_id')->constrained('work_items')->cascadeOnDelete();
            $table->timestamps();

            $table->unique(['type_id', 'source_id', 'target_id']);
            $table->index('target_id');
        });

        Schema::create('work_item_subscribers', function (Blueprint $table) {
            $table->ulid('id')->primary();
            $table->foreignUlid('work_item_id')->constrained()->cascadeOnDelete();
            $table->foreignUlid('user_id')->constrained()->restrictOnDelete();
            $table->string('reason', 16); // created, assigned or manual
            $table->timestamp('unsubscribed_at')->nullable();
            $table->timestamps();

            $table->unique(['work_item_id', 'user_id']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('work_item_subscribers');
        Schema::dropIfExists('work_item_relations');
        Schema::dropIfExists('work_item_labels');
        Schema::dropIfExists('work_item_values');
        Schema::dropIfExists('work_items');
    }
};
