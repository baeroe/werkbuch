<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

// workflow_id and default_type_id get their foreign keys in Phase 3, when workflows and types exist.
// The role of a member lives at spatie (P2), not here.
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('projects', function (Blueprint $table) {
            $table->ulid('id')->primary();
            $table->string('identifier', 10)->unique();
            $table->string('name', 120);
            $table->text('description');
            $table->foreignUlid('lead_id')->constrained('users');
            $table->string('visibility', 16);
            $table->ulid('workflow_id')->nullable();
            $table->ulid('default_type_id')->nullable();
            $table->unsignedInteger('next_number')->default(0);
            $table->timestamp('archived_at')->nullable();
            $table->timestamp('deleting_at')->nullable();
            $table->timestamps();
        });

        Schema::create('project_identifiers', function (Blueprint $table) {
            $table->ulid('id')->primary();
            $table->string('identifier', 10)->unique();
            $table->foreignUlid('project_id')->constrained()->cascadeOnDelete();
            $table->timestamps();
        });

        Schema::create('project_members', function (Blueprint $table) {
            $table->ulid('id')->primary();
            $table->foreignUlid('project_id')->constrained()->cascadeOnDelete();
            $table->foreignUlid('user_id')->constrained()->cascadeOnDelete();
            $table->timestamps();

            $table->unique(['project_id', 'user_id']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('project_members');
        Schema::dropIfExists('project_identifiers');
        Schema::dropIfExists('projects');
    }
};
