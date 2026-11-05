<?php

use App\Access\ProjectRole;
use App\Actions\Projects\ArchiveProject;
use App\Actions\Templates\RunDueTemplates;
use App\Actions\Templates\RunScheduledTemplate;
use App\Actions\Templates\SaveTemplate;
use App\Models\Organization;
use App\Models\Project;
use App\Models\Template;
use App\Models\TemplateRun;
use App\Models\User;
use App\Models\WorkItem;
use App\Support\Actor;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Storage;

// The scheduler (spec 4.12, success criterion 3, A339): every minute it takes the due templates, runs the one term that
// is due (after an outage the last one missed), never one before the schedule was set, resumed or the project restored,
// and counts on the calendar of the organisation.

beforeEach(function () {
    Storage::fake('local');
});

/** WEB with Mara as its admin, the organisation in the zone. */
$project = function (string $zone = 'Europe/Berlin'): array {
    Organization::current()->update(['timezone' => $zone, 'locale' => 'de']);
    $mara = User::factory()->create(['name' => 'Mara', 'handle' => 'mara']);
    $web = Project::factory()->identifier('WEB')->public()->member($mara, ProjectRole::Admin)->create(['lead_id' => $mara->id]);

    return [$web, $mara];
};

/** WEB and a template of Mara with the schedule, set at `$setAt` (UTC). */
$world = function (array $schedule, string $setAt, string $zone = 'Europe/Berlin') use ($project): array {
    [$web, $mara] = $project($zone);
    test()->travelTo($setAt);
    $template = Template::factory()->scheduled(['ends' => ['type' => 'never'], 'interval' => 1, ...$schedule])
        ->create(['project_id' => $web->id, 'created_by' => $mara->id]);

    return [$web, $mara, $template];
};

/** Every Monday at 09:00. */
$mondays = ['frequency' => 'weekly', 'weekdays' => [1], 'time' => '09:00', 'starts_on' => '2026-10-26'];
/** Every day at 09:00. */
$daily = ['frequency' => 'daily', 'time' => '09:00', 'starts_on' => '2026-10-26'];

/** One run of the scheduler at `$at` (UTC) in the process: how many templates it took. */
$tick = function (?string $at = null): int {
    if ($at !== null) {
        test()->travelTo($at);
    }

    return RunDueTemplates::run(Actor::system(User::defaultBot(), 'templates'), true);
};

/** The terms that ran, oldest first, as UTC instants. */
$terms = fn (): array => TemplateRun::query()->orderBy('scheduled_for')->get()->map(fn (TemplateRun $run) => $run->scheduled_for?->toJSON())->all();

it('runs on time', function () use ($world, $mondays, $tick) {
    [$web, , $template] = $world($mondays, '2026-11-01 12:00:00');

    // Monday 08:59:30 in Berlin: not yet
    expect($tick('2026-11-02 07:59:30'))->toBe(0)
        ->and(WorkItem::query()->count())->toBe(0);

    // Monday 09:00:30 in Berlin
    expect($tick('2026-11-02 08:00:30'))->toBe(1);

    $item = WorkItem::query()->sole();
    expect([$item->title, $item->created_by, $item->project_id, $item->template_id])->toBe(['Wartung KW 45', User::defaultBot()->id, $web->id, $template->id])
        ->and($template->fresh()?->next_run_at?->toJSON())->toBe('2026-11-09T08:00:00.000000Z');
});

it('runs a term once, however often the command runs', function () use ($world, $mondays, $tick, $terms) {
    $world($mondays, '2026-11-01 12:00:00');

    $tick('2026-11-02 08:00:30');
    $tick();
    $tick('2026-11-02 08:01:30');
    $tick('2026-11-02 12:00:00');

    expect(WorkItem::query()->count())->toBe(1)
        ->and($terms())->toBe(['2026-11-02T08:00:00.000000Z']);
});

it('after an outage of three weeks catches up the last Monday only, then waits for the next', function () use ($world, $mondays, $tick, $terms) {
    [, , $template] = $world($mondays, '2026-11-01 12:00:00');

    // Wednesday after four missed Mondays (2, 9, 16, 23 November)
    expect($tick('2026-11-25 12:00:00'))->toBe(1);
    expect(WorkItem::query()->sole()->title)->toBe('Wartung KW 48')
        ->and($terms())->toBe(['2026-11-23T08:00:00.000000Z'])
        ->and([$template->fresh()?->run_count, $template->fresh()?->next_run_at?->toJSON()])->toBe([1, '2026-11-30T08:00:00.000000Z']);

    // nothing more until the next Monday
    expect($tick('2026-11-29 12:00:00'))->toBe(0);
    $tick('2026-11-30 08:00:30');
    expect(WorkItem::query()->orderBy('number')->pluck('title')->all())->toBe(['Wartung KW 48', 'Wartung KW 49'])
        ->and($terms())->toBe(['2026-11-23T08:00:00.000000Z', '2026-11-30T08:00:00.000000Z']);
});

it('ends after N runs and catches up at most up to N', function () use ($world, $daily, $tick, $terms) {
    [, , $template] = $world([...$daily, 'ends' => ['type' => 'count', 'count' => 3]], '2026-11-01 12:00:00');

    $tick('2026-11-02 08:00:30');
    $tick('2026-11-03 08:00:30');
    // five days missed: the last one only, and that is the third
    $tick('2026-11-08 12:00:00');
    $tick('2026-11-09 08:00:30');
    $tick('2026-11-10 08:00:30');

    expect($terms())->toBe(['2026-11-02T08:00:00.000000Z', '2026-11-03T08:00:00.000000Z', '2026-11-08T08:00:00.000000Z'])
        ->and([$template->fresh()?->run_count, $template->fresh()?->next_run_at])->toBe([3, null]);
});

it('never runs a term before the schedule was saved or resumed', function () use ($project, $mondays, $tick) {
    [$web, $mara] = $project();
    $input = fn (array $schedule) => ['name' => 'Wartung', 'payload' => ['title' => 'Wartung KW {week}'], 'schedule' => ['interval' => 1, 'ends' => ['type' => 'never'], ...$mondays, 'starts_on' => '2026-10-01', ...$schedule]];
    $runs = fn (): int => TemplateRun::query()->count();

    // saved on Wednesday 2026-11-04 with a start in the past: the Monday before is no term of it
    test()->travelTo('2026-11-04 10:00:00');
    $template = SaveTemplate::run(actor($mara), $web, $input([]));
    expect($template->next_run_at?->toJSON())->toBe('2026-11-09T08:00:00.000000Z');
    // even when next_run_at says otherwise (a stale value): the term is worked out again under the lock
    $template->update(['next_run_at' => '2026-11-02 08:00:00']);
    expect($tick())->toBe(1)
        ->and($runs())->toBe(0)
        ->and($template->fresh()?->next_run_at?->toJSON())->toBe('2026-11-09T08:00:00.000000Z');

    // paused over the Monday, resumed on Tuesday: the Monday is not caught up
    test()->travelTo('2026-11-06 10:00:00');
    SaveTemplate::run(actor($mara), null, $input(['paused' => true]), $template->fresh());
    expect($template->fresh()?->next_run_at)->toBeNull()
        ->and($tick('2026-11-09 08:00:30'))->toBe(0);
    test()->travelTo('2026-11-10 10:00:00');
    SaveTemplate::run(actor($mara), null, $input([]), $template->fresh());
    $template->update(['next_run_at' => '2026-11-09 08:00:00']);
    expect($tick())->toBe(1)
        ->and($runs())->toBe(0)
        ->and($template->fresh()?->next_run_at?->toJSON())->toBe('2026-11-16T08:00:00.000000Z');
});

it('leaves a paused template alone even when its next_run_at is due', function () use ($world, $mondays, $tick) {
    [, , $template] = $world([...$mondays, 'paused' => true], '2026-11-01 12:00:00');
    $template->update(['next_run_at' => '2026-11-02 08:00:00']);

    expect($tick('2026-11-02 08:00:30'))->toBe(0)
        ->and($template->fresh()?->next_run_at?->toJSON())->toBe('2026-11-02T08:00:00.000000Z')
        ->and(TemplateRun::query()->count())->toBe(0);
});

it('skips archived projects and catches up nothing from before the restore', function () use ($world, $daily, $tick, $terms) {
    [$web, $mara, $template] = $world($daily, '2026-11-01 12:00:00');

    test()->travelTo('2026-11-02 07:00:00');
    ArchiveProject::run(actor($mara), $web);
    expect($tick('2026-11-02 08:00:30'))->toBe(0)
        ->and($tick('2026-11-03 08:00:30'))->toBe(0);

    // restored on Tuesday at 11:00: the terms of Monday and Tuesday stay behind
    test()->travelTo('2026-11-03 10:00:00');
    ArchiveProject::run(actor($mara), $web->fresh(), false);
    expect($template->fresh()?->schedule_from?->toJSON())->toBe('2026-11-03T10:00:00.000000Z')
        ->and($template->fresh()?->next_run_at?->toJSON())->toBe('2026-11-04T08:00:00.000000Z')
        ->and($tick('2026-11-03 10:00:30'))->toBe(0);

    $tick('2026-11-04 08:00:30');
    expect($terms())->toBe(['2026-11-04T08:00:00.000000Z']);
});

it('skips a project being deleted', function () use ($world, $daily, $tick) {
    [$web] = $world($daily, '2026-11-01 12:00:00');
    $web->update(['deleting_at' => now()]);

    expect($tick('2026-11-02 08:00:30'))->toBe(0)
        ->and(TemplateRun::query()->count())->toBe(0);
});

it('monthly on the 31st runs on 30 April', function () use ($world, $tick, $terms) {
    [, , $template] = $world(['frequency' => 'monthly', 'month_day' => 31, 'time' => '09:00', 'starts_on' => '2027-01-31'], '2027-04-01 12:00:00');

    expect($template->next_run_at?->toJSON())->toBe('2027-04-30T07:00:00.000000Z')
        ->and($tick('2027-04-30 07:00:30'))->toBe(1)
        ->and($terms())->toBe(['2027-04-30T07:00:00.000000Z'])
        ->and($template->fresh()?->next_run_at?->toJSON())->toBe('2027-05-31T07:00:00.000000Z');
});

it('daily 02:30 runs at 03:30 on 2027-03-28', function () use ($world, $tick, $terms) {
    // 02:30 does not exist that night: the term is 03:30 CEST (01:30 UTC)
    $world(['frequency' => 'daily', 'time' => '02:30', 'starts_on' => '2026-10-01'], '2027-03-27 12:00:00');

    expect($tick('2027-03-28 01:29:30'))->toBe(0)
        ->and($tick('2027-03-28 01:30:30'))->toBe(1)
        ->and($terms())->toBe(['2027-03-28T01:30:00.000000Z']);
});

it('daily 02:30 runs once on 2026-10-25', function () use ($world, $tick, $terms) {
    // 02:30 comes twice that night: the first (CEST, 00:30 UTC) counts, the second (CET, 01:30 UTC) runs nothing
    [, , $template] = $world(['frequency' => 'daily', 'time' => '02:30', 'starts_on' => '2026-10-01'], '2026-10-24 12:00:00');

    expect($tick('2026-10-25 00:30:30'))->toBe(1)
        ->and($tick('2026-10-25 01:30:30'))->toBe(0)
        ->and($terms())->toBe(['2026-10-25T00:30:00.000000Z'])
        ->and($template->fresh()?->next_run_at?->toJSON())->toBe('2026-10-26T01:30:00.000000Z');
});

it('counts in the zone of the organisation, not in UTC', function () use ($world, $daily, $tick, $terms) {
    // set after the term of Sunday in New York (09:00 EST is 14:00 UTC)
    $world($daily, '2026-11-01 15:00:00', 'America/New_York');

    // 09:00 UTC is 04:00 in New York
    expect($tick('2026-11-02 09:00:30'))->toBe(0)
        ->and($tick('2026-11-02 14:00:30'))->toBe(1)
        ->and($terms())->toBe(['2026-11-02T14:00:00.000000Z']);
});

it('only works out next_run_at again for a template with no term due', function () use ($world, $daily) {
    [, , $template] = $world($daily, '2026-11-01 12:00:00');
    $template->update(['next_run_at' => '2026-11-01 20:00:00']);
    test()->travelTo('2026-11-01 21:00:00');
    $stamp = $template->fresh()?->getRawOriginal('updated_at');

    expect(RunScheduledTemplate::run(Actor::system(User::defaultBot(), 'templates'), $template->id))->toBeNull()
        ->and($template->fresh()?->next_run_at?->toJSON())->toBe('2026-11-02T08:00:00.000000Z')
        // the bookkeeping is no save: updated_at stays the mark of the version (K16)
        ->and($template->fresh()?->getRawOriginal('updated_at'))->toBe($stamp)
        ->and(RunScheduledTemplate::run(Actor::system(User::defaultBot(), 'templates'), 'missing'))->toBeNull();
});

it('runs the term after all when it fell due between the first look and the lock', function () use ($world, $daily) {
    [, , $template] = $world($daily, '2026-11-01 12:00:00');
    test()->travelTo('2026-11-02 08:00:30');
    // the organisation as read before the lock is in London (the term of 09:00 not due there yet); the row says Berlin
    $stale = clone Organization::current();
    $stale->timezone = 'Europe/London';
    app()->instance(Organization::class, $stale);

    $ran = RunScheduledTemplate::run(Actor::system(User::defaultBot(), 'templates'), $template->id);

    expect($ran['run']->scheduled_for?->toJSON())->toBe('2026-11-02T08:00:00.000000Z');
});

it('does nothing for a template deleted between the first look and the lock', function () use ($world, $daily) {
    [, , $template] = $world($daily, '2026-11-01 12:00:00');
    test()->travelTo('2026-11-01 21:00:00');
    $once = false;
    DB::connection()->beforeExecuting(function (string $query) use ($template, &$once): void {
        if (! $once && str_starts_with($query, 'select * from `organization`') && str_ends_with($query, 'lock in share mode')) {
            $once = true;
            DB::table('templates')->where('id', $template->id)->delete();
        }
    });

    expect(RunScheduledTemplate::run(Actor::system(User::defaultBot(), 'templates'), $template->id))->toBeNull()
        ->and([$once, Template::query()->count(), TemplateRun::query()->count()])->toBe([true, 0, 0]);
});
