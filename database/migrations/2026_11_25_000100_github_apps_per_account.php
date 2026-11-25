<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * One private GitHub app per GitHub account (WEBU-35, A680): a private app installs only on the account it belongs to,
 * so the instance keeps a list of apps, at most one per account (`owner_login`) and per app ID. Every installation
 * belongs to its app (it goes with it), a delivery of the webhook names the app that sent it (null once the app is gone).
 * What an instance had connected belongs to its one app. Back only with at most one app.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('github_apps', function (Blueprint $table) {
            $table->dropUnique(['singleton']);
            $table->dropColumn('singleton');
            $table->unique('app_id');
            $table->unique('owner_login');
        });

        Schema::table('github_installations', function (Blueprint $table) {
            $table->foreignUlid('github_app_id')->nullable()->after('id')->constrained('github_apps')->cascadeOnDelete();
        });
        Schema::table('github_deliveries', function (Blueprint $table) {
            $table->foreignUlid('github_app_id')->nullable()->after('id')->constrained('github_apps')->nullOnDelete();
        });

        $app = DB::table('github_apps')->orderBy('id')->value('id');
        // an installation without an app cannot be: the app went with all of them (DisconnectGitHub)
        DB::table('github_installations')->update(['github_app_id' => $app]);
        DB::table('github_installations')->whereNull('github_app_id')->delete();
        DB::table('github_deliveries')->update(['github_app_id' => $app]);

        Schema::table('github_installations', function (Blueprint $table) {
            $table->foreignUlid('github_app_id')->nullable(false)->change();
        });
    }

    public function down(): void
    {
        if (DB::table('github_apps')->count() > 1) {
            throw new RuntimeException('More than one GitHub app is connected: disconnect all but one before going back.');
        }

        Schema::table('github_deliveries', function (Blueprint $table) {
            $table->dropConstrainedForeignId('github_app_id');
        });
        Schema::table('github_installations', function (Blueprint $table) {
            $table->dropConstrainedForeignId('github_app_id');
        });
        Schema::table('github_apps', function (Blueprint $table) {
            $table->dropUnique(['app_id']);
            $table->dropUnique(['owner_login']);
            $table->unsignedTinyInteger('singleton')->default(1)->unique()->after('id');
        });
    }
};
