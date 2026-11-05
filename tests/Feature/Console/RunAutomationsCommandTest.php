<?php

use App\Domain\Automations\AutomationKey;
use App\Models\Automation;
use App\Models\Organization;
use App\Models\Project;
use App\Models\WorkItem;
use Carbon\CarbonImmutable;

// `app:run-automations`: the nightly automations in this process, for the current hour (they act at 03:00 in the zone of
// the organisation only); `--now` acts at any hour, `--project=<ULID>` in that project only (e2e, K9).

beforeEach(function () {
    Organization::current()->update(['timezone' => 'Europe/Berlin']);
});

/** A project with Auto-Archiv on and an item closed 40 days ago. */
$closedIn = function (): WorkItem {
    $project = Project::factory()->create();
    Automation::factory()->for($project)->key(AutomationKey::AutoArchive)->enabled()->create();

    return WorkItem::factory()->for($project)->closed()->create(['closed_at' => now()->subDays(40)]);
};

it('acts with --now at any hour and says what it did', function () use ($closedIn) {
    $this->travelTo(CarbonImmutable::parse('2026-11-10 12:34', 'UTC'));
    $item = $closedIn();

    $this->artisan('app:run-automations', ['--now' => true])
        ->expectsOutput('Archived 1, closed 0, skipped 0.')
        ->assertSuccessful();

    expect($item->fresh()->archived_at)->not->toBeNull();

    $this->artisan('app:run-automations', ['--now' => true])->expectsOutput('Archived 0, closed 0, skipped 0.')->assertSuccessful();
});

it('acts without --now only in the night hour of the organisation', function () use ($closedIn) {
    $this->travelTo(CarbonImmutable::parse('2026-11-10 12:34', 'UTC'));
    $item = $closedIn();

    $this->artisan('app:run-automations')->expectsOutput('Archived 0, closed 0, skipped 0.')->assertSuccessful();
    expect($item->fresh()->archived_at)->toBeNull();

    // 03:12 in Berlin
    $this->travelTo(CarbonImmutable::parse('2026-11-10 02:12', 'UTC'));
    $this->artisan('app:run-automations')->expectsOutput('Archived 1, closed 0, skipped 0.')->assertSuccessful();
});

it('acts in the project it names only (K9)', function () use ($closedIn) {
    $this->travelTo(CarbonImmutable::parse('2026-11-10 12:34', 'UTC'));
    $other = $closedIn();
    $item = $closedIn();

    $this->artisan('app:run-automations', ['--now' => true, '--project' => $item->project_id])
        ->expectsOutput('Archived 1, closed 0, skipped 0.')
        ->assertSuccessful();

    expect($item->fresh()->archived_at)->not->toBeNull()
        ->and($other->fresh()->archived_at)->toBeNull();
});
