<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

// Attachments (spec 4.16): a file of a project, as a picture or file in a text (`inline`) or in the file list of an item
// (`file`). The owner is polymorphic without a foreign key (an item, from Phase 7 on a comment) and empty until a text
// that names the upload is saved (A232). `mime` is read from the content, never taken from the client (A236). The file
// itself is the media collection `file` of the row.
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('attachments', function (Blueprint $table) {
            $table->ulid('id')->primary();
            $table->foreignUlid('project_id')->constrained()->cascadeOnDelete();
            $table->nullableUlidMorphs('attachable');
            $table->string('kind', 8);
            $table->foreignUlid('uploaded_by')->constrained('users')->restrictOnDelete();
            $table->string('filename', 255);
            $table->string('mime', 127);
            $table->unsignedBigInteger('size');
            $table->timestamps();

            // the clean-up of uploads nobody owns, per project and age
            $table->index(['project_id', 'attachable_id', 'created_at']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('attachments');
    }
};
