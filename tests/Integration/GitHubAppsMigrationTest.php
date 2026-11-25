<?php

use App\Models\GitHubApp;
use App\Models\GitHubDelivery;
use App\Models\GitHubInstallation;
use Illuminate\Support\Facades\Artisan;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;
use Illuminate\Support\Str;

/*
 * The migration 2026_11_25_000100 (WEBU-35, A680): what an instance had connected belongs to its one app afterwards
 * (installations and deliveries), the list of apps is unique per account; back only with at most one app.
 */

const GITHUB_APPS_MIGRATION = 'database/migrations/2026_11_25_000100_github_apps_per_account.php';

it('gives the installations and deliveries of an instance its one app and goes back while there is one', function () {
    $app = GitHubApp::factory()->create();
    $this->artisan('migrate:rollback', ['--path' => GITHUB_APPS_MIGRATION])->assertSuccessful();
    expect(Schema::hasColumn('github_installations', 'github_app_id'))->toBeFalse()
        ->and(Schema::hasColumn('github_apps', 'singleton'))->toBeTrue();

    $installation = (string) Str::ulid();
    DB::table('github_installations')->insert(['id' => $installation, 'installation_id' => 55_000_001, 'account_login' => 'feldwerk', 'account_type' => 'Organization',
        'repository_selection' => 'selected', 'created_at' => now(), 'updated_at' => now()]);
    DB::table('github_deliveries')->insert(['id' => (string) Str::ulid(), 'delivery_id' => 'd-1', 'event' => 'ping', 'payload' => '{}', 'received_at' => now()]);

    $this->artisan('migrate')->assertSuccessful();

    expect(GitHubInstallation::query()->sole()->github_app_id)->toBe($app->id)
        ->and(GitHubDelivery::query()->sole()->github_app_id)->toBe($app->id)
        ->and(Schema::hasColumn('github_apps', 'singleton'))->toBeFalse();
});

it('refuses to go back with two apps', function () {
    GitHubApp::factory()->create();
    GitHubApp::factory()->account('feldwerk-labs')->create();

    expect(fn () => Artisan::call('migrate:rollback', ['--path' => GITHUB_APPS_MIGRATION]))->toThrow(RuntimeException::class, 'More than one GitHub app');
    expect(GitHubApp::query()->count())->toBe(2);

    // DatabaseMigrations rolls everything back after the test: with one app it may
    GitHubApp::query()->where('owner_login', 'feldwerk-labs')->delete();
});
