<?php

use App\Access\OrgRole;
use App\Access\RoleAssignments;
use App\Access\Visibility;
use App\Actions\Automations\RunDailyAutomations;
use App\Domain\Automations\AutomationKey;
use App\Events\EventType;
use App\Exceptions\Problem;
use App\Jobs\RunDailyAutomationsJob;
use App\Models\Automation;
use App\Models\Event;
use App\Models\Organization;
use App\Models\Project;
use App\Models\User;
use App\Models\WorkItem;
use App\Support\Actor;
use Carbon\CarbonImmutable;
use Illuminate\Console\Scheduling\Schedule;
use Illuminate\Database\Events\QueryExecuted;
use Illuminate\Queue\Middleware\WithoutOverlapping;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Exceptions;
use Illuminate\Support\Str;

/*
 * The nightly automations (spec 4.13, K19): a job every hour that acts only in the hour 03:00–03:59 in the zone of the
 * organisation (NightlyRun), for the hour it was planned in; a second run the same night finds nothing more to do.
 */

$run = fn (string $hourUtc, bool $force = false, ?string $project = null): array => RunDailyAutomations::run(
    Actor::system(User::defaultBot(), 'daily_automations'), CarbonImmutable::parse($hourUtc, 'UTC'), $force, $project,
);

/** A project with Auto-Archiv and Auto-Close on, an item closed 40 days ago and one in the backlog untouched for 100. */
$world = function (): array {
    $project = Project::factory()->create();
    Automation::factory()->for($project)->key(AutomationKey::AutoArchive)->enabled()->create();
    $canceled = (string) $project->workflow()->firstOrFail()->states()->where('name', 'Cancelled')->value('id');
    Automation::factory()->for($project)->key(AutomationKey::AutoClose)->enabled(['state_id' => $canceled])->create();
    $closed = WorkItem::factory()->for($project)->closed()->create(['closed_at' => now()->subDays(40)]);
    $stale = WorkItem::factory()->for($project)->inState('Backlog')->create(['updated_at' => now()->subDays(100)]);

    return [$project, $closed, $stale];
};

$nothing = ['archived' => 0, 'closed' => 0, 'skipped' => 0];

it('acts at 03:00 in the zone of the organisation only', function (string $zone, string $before, string $due, string $after) use ($run, $world, $nothing) {
    Organization::current()->update(['timezone' => $zone]);
    $this->travelTo(CarbonImmutable::parse($before, 'UTC'));
    [, $closed] = $world();

    expect($run($before))->toBe($nothing)
        ->and($run($after))->toBe($nothing)
        ->and($closed->fresh()->archived_at)->toBeNull();

    $this->travelTo(CarbonImmutable::parse($due, 'UTC')->addMinutes(5));

    expect($run($due))->toBe(['archived' => 1, 'closed' => 1, 'skipped' => 0])
        ->and($closed->fresh()->archived_at)->not->toBeNull();
})->with([
    'Berlin in winter' => ['Europe/Berlin', '2026-11-10 01:00', '2026-11-10 02:00', '2026-11-10 03:00'],
    'Berlin in summer' => ['Europe/Berlin', '2026-07-10 00:00', '2026-07-10 01:00', '2026-07-10 02:00'],
    'New York in winter' => ['America/New_York', '2026-11-10 07:00', '2026-11-10 08:00', '2026-11-10 09:00'],
]);

it('a second run the same night changes nothing', function () use ($run, $world, $nothing) {
    $this->travelTo(CarbonImmutable::parse('2026-11-10 02:00', 'UTC'));
    [, $closed, $stale] = $world();

    expect($run('2026-11-10 02:00', true))->toBe(['archived' => 1, 'closed' => 1, 'skipped' => 0]);
    $events = Event::query()->count();
    $state = $stale->fresh()->state_id;

    $this->travelTo(CarbonImmutable::parse('2026-11-10 02:30', 'UTC'));

    expect($run('2026-11-10 02:00', true))->toBe($nothing)
        ->and(Event::query()->count())->toBe($events)
        ->and($stale->fresh()->state_id)->toBe($state)
        ->and($closed->fresh()->archived_at)->not->toBeNull();
});

it('acts at any hour when forced, and in one project only when it names one (K9)', function () use ($run, $world) {
    $this->travelTo(CarbonImmutable::parse('2026-11-10 12:00', 'UTC'));
    [, $closedFirst] = $world();
    [$second, $closedSecond] = $world();

    expect($run('2026-11-10 12:00', true, $second->id))->toBe(['archived' => 1, 'closed' => 1, 'skipped' => 0])
        ->and($closedFirst->fresh()->archived_at)->toBeNull()
        ->and($closedSecond->fresh()->archived_at)->not->toBeNull();
});

it('runs every hour from its job on the queue bulk, for the hour it was planned in, one at a time (K19)', function () use ($world) {
    Organization::current()->update(['timezone' => 'Europe/Berlin']);
    [, $closed] = $world();
    $task = collect(app(Schedule::class)->events())->sole(fn ($event) => $event->description === RunDailyAutomationsJob::class);
    $job = new RunDailyAutomationsJob(CarbonImmutable::parse('2026-11-10 02:00', 'UTC'));
    $middleware = $job->middleware();

    // the job of 02:00 UTC (03:00 in Berlin) waited on the queue until 04:10 UTC: it still runs the night
    $this->travelTo(CarbonImmutable::parse('2026-11-10 04:10', 'UTC'));
    $job->handle();

    expect($task->expression)->toBe('0 * * * *')
        ->and($task->withoutOverlapping)->toBeTrue()
        ->and($task->expiresAt)->toBe(60)
        ->and($job->queue)->toBe('bulk')
        ->and($middleware)->toHaveCount(1)
        ->and($middleware[0])->toBeInstanceOf(WithoutOverlapping::class)
        ->and($middleware[0]->key)->toBe('daily-automations')
        ->and($middleware[0]->releaseAfter)->toBeNull()
        ->and($middleware[0]->expiresAfter)->toBe(3600)
        ->and($closed->fresh()->archived_at)->not->toBeNull()
        ->and(eventsOf(EventType::WorkItemArchived, $closed)->sole()->meta['reason'])->toBe('auto_archive');
});

it('passes over the items of a project that is archived or being deleted after they were read', function (string $column) use ($run, $world, $nothing) {
    Exceptions::fake();
    $this->travelTo(CarbonImmutable::parse('2026-11-10 02:00', 'UTC'));
    [$project, $closed, $stale] = $world();
    $done = false;
    // right after the candidates are read, before the first of them is locked
    DB::listen(function (QueryExecuted $query) use ($project, $column, &$done): void {
        if (! $done && str_starts_with($query->sql, 'select `work_items`.* from `work_items`') && str_contains($query->sql, 'limit 200')) {
            $done = true;
            DB::table('projects')->where('id', $project->id)->update([$column => now()]);
        }
    });

    expect($run('2026-11-10 02:00', true))->toBe($nothing)
        ->and($done)->toBeTrue()
        ->and($closed->fresh()->archived_at)->toBeNull()
        ->and($stale->fresh()->state_id)->toBe($stale->state_id);
    Exceptions::assertNothingReported();
})->with(['archived_at', 'deleting_at']);

it('passes over an item deleted after it was read, without a report', function () use ($run, $world) {
    Exceptions::fake();
    $this->travelTo(CarbonImmutable::parse('2026-11-10 02:00', 'UTC'));
    [, $closed, $stale] = $world();
    $done = false;
    // right after the stale items are read, before the first of them is locked
    DB::listen(function (QueryExecuted $query) use ($stale, &$done): void {
        if (! $done && str_starts_with($query->sql, 'select `work_items`.* from `work_items`') && str_contains($query->sql, 'limit 200')
            && str_contains($query->sql, 'max(comments.created_at)')) {
            $done = true;
            DB::table('work_items')->where('id', $stale->id)->delete();
        }
    });

    expect($run('2026-11-10 02:00', true))->toBe(['archived' => 1, 'closed' => 0, 'skipped' => 0])
        ->and($done)->toBeTrue()
        ->and($closed->fresh()->archived_at)->not->toBeNull();
    Exceptions::assertNothingReported();
});

it('reports a 404 of the work after the lock, counts the item as skipped and leaves nothing behind', function () use ($run) {
    Exceptions::fake();
    $this->travelTo(CarbonImmutable::parse('2026-11-10 02:00', 'UTC'));
    $project = Project::factory()->private()->create();
    $canceled = (string) $project->workflow()->firstOrFail()->states()->where('name', 'Cancelled')->value('id');
    Automation::factory()->for($project)->key(AutomationKey::AutoClose)->enabled(['state_id' => $canceled])->create();
    $stale = WorkItem::factory()->for($project)->inState('Backlog')->create(['updated_at' => now()->subDays(100)]);
    // a broken invariant: the default bot no longer sees the private project, so the comment after the move is a 404
    app(RoleAssignments::class)->setOrgRole(User::defaultBot(), OrgRole::Member);
    Visibility::forget();

    expect($run('2026-11-10 02:00', true))->toBe(['archived' => 0, 'closed' => 0, 'skipped' => 1])
        ->and($stale->fresh()->state_id)->toBe($stale->state_id)
        ->and(eventsOf(EventType::WorkItemStateChanged, $stale))->toHaveCount(0);
    Exceptions::assertReported(fn (RuntimeException $e) => str_contains($e->getMessage(), $stale->id)
        && $e->getPrevious() instanceof Problem && $e->getPrevious()->status === 404);
});

it('checks each item again under its lock: reopened or commented after it was read, it stays', function () use ($run, $world, $nothing) {
    $this->travelTo(CarbonImmutable::parse('2026-11-10 02:00', 'UTC'));
    [$project, $closed, $stale] = $world();
    $backlog = (string) $project->workflow()->firstOrFail()->states()->where('name', 'Backlog')->value('id');
    $reads = 0;
    DB::listen(function (QueryExecuted $query) use ($closed, $stale, $backlog, &$reads): void {
        if (str_starts_with($query->sql, 'select `work_items`.* from `work_items`') && str_contains($query->sql, 'limit 200') && ++$reads <= 2) {
            // the first read are the closed items, the second the stale ones
            $reads === 1
                ? DB::table('work_items')->where('id', $closed->id)->update(['state_id' => $backlog, 'closed_at' => null, 'updated_at' => now()])
                : DB::table('comments')->insert(['id' => strtolower((string) Str::ulid()), 'work_item_id' => $stale->id, 'author_id' => User::defaultBot()->id, 'body' => '{}', 'body_text' => '', 'created_at' => now()->subDay(), 'updated_at' => now()->subDay()]);
        }
    });

    expect($run('2026-11-10 02:00', true))->toBe($nothing)
        ->and($reads)->toBe(2)
        ->and($closed->fresh()->archived_at)->toBeNull()
        ->and($stale->fresh()->state_id)->toBe($stale->state_id);
});

it('reports an item that fails with anything but a refusal, counts it as skipped and goes on with the night (W1)', function () use ($run) {
    Exceptions::fake();
    $this->travelTo(CarbonImmutable::parse('2026-11-10 02:00', 'UTC'));
    $project = Project::factory()->create();
    $canceled = (string) $project->workflow()->firstOrFail()->states()->where('name', 'Cancelled')->value('id');
    Automation::factory()->for($project)->key(AutomationKey::AutoClose)->enabled(['state_id' => $canceled])->create();
    [$first, $second] = WorkItem::factory()->for($project)->inState('Backlog')->count(2)->create(['updated_at' => now()->subDays(100)])
        ->sortBy('id')->values()->all();
    $later = Project::factory()->create();
    Automation::factory()->for($later)->key(AutomationKey::AutoArchive)->enabled()->create();
    $closed = WorkItem::factory()->for($later)->closed()->create(['closed_at' => now()->subDays(40)]);
    // the lock of the first item fails as a lock wait timeout would after its three attempts
    DB::listen(function (QueryExecuted $query) use ($first): void {
        if (str_contains($query->sql, 'for update') && str_starts_with($query->sql, 'select * from `work_items`') && in_array($first->id, $query->bindings, true)) {
            throw new RuntimeException('Lock wait timeout exceeded');
        }
    });

    expect($run('2026-11-10 02:00', true))->toBe(['archived' => 1, 'closed' => 1, 'skipped' => 1])
        ->and($first->fresh()->state_id)->toBe($first->state_id)
        ->and($second->fresh()->state_id)->toBe($canceled)
        ->and($closed->fresh()->archived_at)->not->toBeNull();
    Exceptions::assertReported(fn (RuntimeException $e) => $e->getMessage() === 'Lock wait timeout exceeded');
});
