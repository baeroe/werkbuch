<?php

use App\Actions\Webhooks\SaveWebhook;
use App\Models\Project;
use App\Models\User;
use App\Models\Webhook;
use App\Support\Actor;
use Illuminate\Database\QueryException;
use Illuminate\Support\Facades\DB;
use Tests\Support\RaceConnections;

/*
 * Saving a project webhook while its project is being purged (T3-M1, CLAUDE.md "organization → project → …"):
 * PurgeProject holds the project row and then reaches the webhook through the cascade. SaveWebhook takes the project it
 * is sent first (shared) and only then the webhook (`for update`), so the two never wait for each other in a circle.
 */

beforeEach(fn () => RaceConnections::setUp());

afterEach(fn () => RaceConnections::tearDown());

it('takes the project before the webhook, so a purge of the project never deadlocks with it', function () {
    $admin = User::factory()->admin()->create();
    $project = Project::factory()->create();
    $webhook = Webhook::factory()->forProject($project)->create(['name' => 'Agent']);
    $input = [
        'name' => 'Agent 2', 'url' => $webhook->url, 'project_id' => $project->id, 'events' => $webhook->events,
        'bot_id' => null, 'active' => true,
    ];

    // the purge holds the project ...
    RaceConnections::hold(function () use ($project) {
        DB::connection('mariadb')->statement('SET innodb_lock_wait_timeout = 1');
        DB::connection('mariadb')->table('projects')->where('id', $project->id)->lockForUpdate()->first();
    });

    // ... and, when saving asks for the project, reaches for the webhook as its cascade would: it is still free
    $purgeTookWebhook = null;
    DB::connection('mariadb_second')->beforeExecuting(function (string $query) use ($webhook, &$purgeTookWebhook) {
        if ($purgeTookWebhook === null && str_starts_with($query, 'select * from `projects`') && str_ends_with($query, 'lock in share mode')) {
            try {
                DB::connection('mariadb')->table('webhooks')->where('id', $webhook->id)->lockForUpdate()->first();
                $purgeTookWebhook = true;
            } catch (QueryException) {
                $purgeTookWebhook = false;
            }
        }
    });

    $outcome = RaceConnections::second(fn () => SaveWebhook::run(Actor::system($admin, 'test'), $input, $webhook));

    expect($purgeTookWebhook)->toBeTrue();
    RaceConnections::expectLockWait($outcome, 'projects', sqlEnd: 'lock in share mode');

    RaceConnections::release();
    expect($webhook->fresh()->name)->toBe('Agent');
});

it('saves once the purge left the project in place', function () {
    $admin = User::factory()->admin()->create();
    $project = Project::factory()->create();
    $webhook = Webhook::factory()->forProject($project)->create(['name' => 'Agent']);
    $input = [
        'name' => 'Agent 2', 'url' => $webhook->url, 'project_id' => $project->id, 'events' => $webhook->events,
        'bot_id' => null, 'active' => true,
    ];

    RaceConnections::hold(fn () => DB::connection('mariadb')->table('projects')->where('id', $project->id)->lockForUpdate()->first());
    RaceConnections::releaseBeforeLock('projects', 'lock in share mode');

    $saved = RaceConnections::second(fn () => SaveWebhook::run(Actor::system($admin, 'test'), $input, $webhook));

    expect($saved['webhook']->name)->toBe('Agent 2');
});
