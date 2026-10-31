<?php

use App\Actions\Setup\LinkProjectsToCatalog;
use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

// Every project gets a workflow, switched-on types and a default type (LinkProjectsToCatalog binds those of Phase 2);
// then `workflow_id` and `default_type_id` are required and foreign keys that keep the workflow and the type (P23).
return new class extends Migration
{
    public function up(): void
    {
        LinkProjectsToCatalog::run();

        Schema::table('projects', function (Blueprint $table) {
            $table->ulid('workflow_id')->nullable(false)->change();
            $table->ulid('default_type_id')->nullable(false)->change();
            $table->foreign('workflow_id')->references('id')->on('workflows')->restrictOnDelete();
            $table->foreign('default_type_id')->references('id')->on('work_item_types')->restrictOnDelete();
        });
    }

    public function down(): void
    {
        Schema::table('projects', function (Blueprint $table) {
            $table->dropForeign(['workflow_id']);
            $table->dropForeign(['default_type_id']);
            // the indexes the foreign keys brought along
            $table->dropIndex('projects_workflow_id_foreign');
            $table->dropIndex('projects_default_type_id_foreign');
            $table->ulid('workflow_id')->nullable()->change();
            $table->ulid('default_type_id')->nullable()->change();
        });
    }
};
