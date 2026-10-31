<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

// The catalogs of the organization (spec 4.5 to 4.8). `workflows.initial_state_id` has no foreign key (P13), and
// `projects.workflow_id` and `default_type_id` get theirs with the shipped catalog (Task 8).
// Names and keys are unique through the collation (utf8mb4_unicode_ci), so without regard to case.
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('workflows', function (Blueprint $table) {
            $table->ulid('id')->primary();
            $table->string('name', 60)->unique();
            $table->text('description');
            $table->boolean('is_default')->default(false);
            $table->boolean('is_free')->default(true);
            $table->ulid('initial_state_id')->nullable();
            $table->timestamps();
        });

        Schema::create('workflow_states', function (Blueprint $table) {
            $table->ulid('id')->primary();
            $table->foreignUlid('workflow_id')->constrained()->cascadeOnDelete();
            $table->string('name', 40);
            $table->string('icon', 16);
            $table->string('category', 16);
            $table->unsignedSmallInteger('position');
            $table->timestamps();

            $table->index(['workflow_id', 'position']);
        });

        Schema::create('workflow_transitions', function (Blueprint $table) {
            $table->ulid('id')->primary();
            $table->foreignUlid('workflow_id')->constrained()->cascadeOnDelete();
            $table->foreignUlid('from_state_id')->constrained('workflow_states')->cascadeOnDelete();
            $table->foreignUlid('to_state_id')->constrained('workflow_states')->cascadeOnDelete();
            $table->timestamps();

            $table->unique(['from_state_id', 'to_state_id']);
        });

        Schema::create('work_item_types', function (Blueprint $table) {
            $table->ulid('id')->primary();
            $table->string('name', 60)->unique();
            $table->string('icon', 40);
            $table->string('tone', 16);
            $table->text('description');
            $table->boolean('is_epic')->default(false);
            $table->timestamp('archived_at')->nullable();
            $table->timestamps();
        });

        Schema::create('properties', function (Blueprint $table) {
            $table->ulid('id')->primary();
            $table->string('key', 40)->unique();
            $table->string('label', 60);
            $table->string('field_type', 16);
            $table->text('help');
            $table->json('default_value')->nullable();
            $table->json('settings');
            $table->timestamps();
        });

        Schema::create('property_options', function (Blueprint $table) {
            $table->ulid('id')->primary();
            $table->foreignUlid('property_id')->constrained()->cascadeOnDelete();
            $table->string('label', 60);
            $table->string('color', 16);
            $table->unsignedSmallInteger('position');
            $table->timestamp('archived_at')->nullable();
            $table->timestamps();

            $table->index(['property_id', 'position']);
        });

        Schema::create('type_properties', function (Blueprint $table) {
            $table->ulid('id')->primary();
            $table->foreignUlid('type_id')->constrained('work_item_types')->cascadeOnDelete();
            $table->foreignUlid('property_id')->constrained()->cascadeOnDelete();
            $table->boolean('required')->default(false);
            $table->unsignedSmallInteger('position');
            $table->timestamps();

            $table->unique(['type_id', 'property_id']);
        });

        Schema::create('project_types', function (Blueprint $table) {
            $table->ulid('id')->primary();
            $table->foreignUlid('project_id')->constrained()->cascadeOnDelete();
            $table->foreignUlid('type_id')->constrained('work_item_types')->cascadeOnDelete();
            $table->timestamps();

            $table->unique(['project_id', 'type_id']);
        });

        Schema::create('labels', function (Blueprint $table) {
            $table->ulid('id')->primary();
            $table->string('name', 60)->unique();
            $table->string('color', 16);
            $table->timestamps();
        });

        Schema::create('relation_types', function (Blueprint $table) {
            $table->ulid('id')->primary();
            $table->string('name', 60)->unique();
            $table->string('outward_label', 60);
            $table->string('inward_label', 60)->nullable(); // null: symmetric
            $table->string('built_in', 16)->nullable()->unique();
            $table->timestamps();
        });

        Schema::create('resolutions', function (Blueprint $table) {
            $table->ulid('id')->primary();
            $table->string('label', 60)->unique();
            $table->string('default_for', 16)->nullable()->unique(); // completed or canceled
            $table->unsignedSmallInteger('position');
            $table->timestamp('archived_at')->nullable();
            $table->timestamps();
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('resolutions');
        Schema::dropIfExists('relation_types');
        Schema::dropIfExists('labels');
        Schema::dropIfExists('project_types');
        Schema::dropIfExists('type_properties');
        Schema::dropIfExists('property_options');
        Schema::dropIfExists('properties');
        Schema::dropIfExists('work_item_types');
        Schema::dropIfExists('workflow_transitions');
        Schema::dropIfExists('workflow_states');
        Schema::dropIfExists('workflows');
    }
};
