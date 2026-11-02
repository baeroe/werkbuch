<?php

use App\Models\Project;
use App\Models\User;
use App\Models\WorkItem;

it('syncs the settings', function () {
    $engine = searchEngine();

    $this->artisan('app:search-sync')->expectsOutput('Search settings synced.')->assertExitCode(0);

    $settings = config('scout.meilisearch.index-settings');
    expect($engine->updatedSettings('testing_work_items'))->toBe($settings[WorkItem::class])
        ->and($engine->updatedSettings('testing_projects'))->toBe($settings[Project::class])
        ->and($engine->updatedSettings('testing_users'))->toBe($settings[User::class])
        ->and($engine->documents('testing_work_items'))->toBe([]);
});

it('imports everything and says how much', function () {
    $engine = searchEngine();
    $web = Project::factory()->identifier('WEB')->create();
    $ops = Project::factory()->identifier('OPS')->create();
    $gone = Project::factory()->identifier('GONE')->create(['deleting_at' => now()]);
    WorkItem::factory()->for($web)->count(2)->create();
    WorkItem::factory()->for($ops)->create();
    WorkItem::factory()->for($gone)->create();
    $accounts = User::count();

    $this->artisan('app:search-import')
        ->expectsOutput("Indexed 3 work items, 2 projects, {$accounts} accounts.")
        ->assertExitCode(0);

    expect($engine->documents('testing_work_items'))->toHaveCount(3)
        ->and($engine->documents('testing_projects'))->toHaveCount(2)
        ->and($engine->documents('testing_users'))->toHaveCount($accounts)
        ->and($engine->updatedSettings('testing_work_items'))->not->toBeNull();
});
