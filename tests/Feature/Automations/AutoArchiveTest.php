<?php

use App\Access\ProjectRole;
use App\Actions\Automations\RunDailyAutomations;
use App\Actions\WorkItems\ListHistory;
use App\Domain\Automations\AutomationKey;
use App\Events\EventType;
use App\Http\Resources\HistoryEntryResource;
use App\Models\Automation;
use App\Models\Organization;
use App\Models\Project;
use App\Models\User;
use App\Models\WorkItem;
use App\Support\Actor;
use Carbon\CarbonImmutable;

/*
 * Auto-Archiv (spec 4.13): every night at 03:00 in the zone of the organisation the default bot archives the items in a
 * Completed or Canceled state that closed at least `days` days ago (30 to start with), in every project with the
 * automation switched on that is neither archived nor being deleted. The history names the reason.
 */

beforeEach(function () {
    Organization::current()->update(['timezone' => 'Europe/Berlin', 'locale' => 'de']);
    // 03:00 in Berlin (winter)
    $this->travelTo(CarbonImmutable::parse('2026-11-10 02:00:00', 'UTC'));
});

$run = fn (): array => RunDailyAutomations::run(Actor::system(User::defaultBot(), 'daily_automations'), CarbonImmutable::parse('2026-11-10 02:00:00', 'UTC'));

/**
 * @param  array<string, mixed>  $project
 * @param  array<string, mixed>  $settings
 */
$projectWith = function (bool $on = true, array $project = [], array $settings = []): Project {
    $created = Project::factory()->create($project);
    $automation = Automation::factory()->for($created)->key(AutomationKey::AutoArchive);
    ($on ? $automation->enabled($settings) : $automation)->create();

    return $created;
};

$closedAgo = fn (Project $project, int $days, string $state = 'Done'): WorkItem => WorkItem::factory()->for($project)->closed()->inState($state)
    ->create(['closed_at' => now()->subDays($days)]);

it('archives items closed for 30 days, not 29', function () use ($run, $projectWith, $closedAgo) {
    $web = $projectWith();
    $thirty = $closedAgo($web, 30);
    $canceled = $closedAgo($web, 45, 'Cancelled');
    $twentyNine = $closedAgo($web, 29);

    expect($run())->toBe(['archived' => 2, 'closed' => 0, 'skipped' => 0])
        ->and($thirty->fresh()->archived_at?->toIso8601String())->toBe(now()->toIso8601String())
        ->and($canceled->fresh()->archived_at)->not->toBeNull()
        ->and($twentyNine->fresh()->archived_at)->toBeNull();
});

it('waits the days of its settings', function () use ($run, $projectWith, $closedAgo) {
    $web = $projectWith(settings: ['days' => 7]);
    $seven = $closedAgo($web, 7);
    $six = $closedAgo($web, 6);

    expect($run()['archived'])->toBe(1)
        ->and($seven->fresh()->archived_at)->not->toBeNull()
        ->and($six->fresh()->archived_at)->toBeNull();
});

it('leaves open items, archived projects and projects being deleted alone', function () use ($run, $projectWith, $closedAgo) {
    $web = $projectWith();
    $open = WorkItem::factory()->for($web)->inState('Backlog')->create(['updated_at' => now()->subDays(400)]);
    $archived = $projectWith(project: ['archived_at' => now()->subDay()]);
    $deleting = $projectWith(project: ['deleting_at' => now()->subMinute()]);
    $off = $projectWith(false);
    $items = [$closedAgo($archived, 60), $closedAgo($deleting, 60), $closedAgo($off, 60)];
    $already = WorkItem::factory()->for($web)->archived()->create(['closed_at' => now()->subDays(60), 'archived_at' => now()->subDays(20)]);

    expect($run())->toBe(['archived' => 0, 'closed' => 0, 'skipped' => 0])
        ->and($open->fresh()->archived_at)->toBeNull()
        ->and(collect($items)->map(fn (WorkItem $item) => $item->fresh()->archived_at)->filter()->all())->toBe([])
        ->and($already->fresh()->archived_at?->toIso8601String())->toBe(now()->subDays(20)->toIso8601String())
        ->and(eventsOf(EventType::WorkItemArchived)->count())->toBe(0);
});

it('names the automation in the history', function () use ($run, $projectWith, $closedAgo) {
    $web = $projectWith();
    $mara = memberOf($web, ProjectRole::Admin);
    $item = $closedAgo($web, 31);

    $run();

    $archived = eventsOf(EventType::WorkItemArchived, $item)->sole();
    $history = collect(ListHistory::run(actor($mara), $item, [])->page->items())->map(fn ($e) => (new HistoryEntryResource($e))->resolve())->last();

    expect($archived->actor_id)->toBe(User::defaultBot()->id)
        ->and($archived->meta)->toMatchArray(['via' => Actor::VIA_AUTOMATION, 'reason' => 'auto_archive'])
        ->and($archived->meta)->not->toHaveKey('on_behalf_of')
        ->and($history)->toMatchArray(['type' => 'work_item.archived', 'reason' => 'auto_archive', 'via' => 'automation', 'actor_id' => User::defaultBot()->id]);
});
