<?php

use App\Access\ProjectRole;
use App\Actions\Organization\UpdateOrganization;
use App\Actions\Templates\RunTemplate;
use App\Actions\Templates\SaveTemplate;
use App\Actions\WorkItems\CreateWorkItem;
use App\Models\Organization;
use App\Models\Project;
use App\Models\Template;
use App\Models\TemplateRun;
use App\Models\User;
use App\Models\WorkItem;
use Tests\Support\RaceConnections;

/*
 * One term, one item (Erfolgskriterium 3, K3, K16): a run locks the organisation (shared), the project and the template,
 * works out its term again under them and writes one row per term. `mariadb` holds the first request open like one in
 * progress, `mariadb_second` is the run and gives up waiting for a lock after one second.
 */

beforeEach(function () {
    RaceConnections::setUp();
    Organization::current()->update(['timezone' => 'Europe/Berlin', 'locale' => 'de']);
});

afterEach(fn () => RaceConnections::tearDown());

/** WEB with Mara as its admin and a template running daily at 09:00 in Berlin since 2026-11-01 12:00 UTC; now the term of 2026-11-02. */
$world = function (): array {
    test()->travelTo('2026-11-01 12:00:00');
    $mara = User::factory()->create(['name' => 'Mara', 'handle' => 'mara']);
    $web = Project::factory()->member($mara, ProjectRole::Admin)->create(['lead_id' => $mara->id]);
    $template = Template::factory()->scheduled(['frequency' => 'daily', 'interval' => 1, 'time' => '09:00', 'starts_on' => '2026-11-01', 'ends' => ['type' => 'never']])
        ->create(['project_id' => $web->id, 'created_by' => $mara->id]);
    test()->travelTo('2026-11-02 08:00:20');

    return [$web, $mara, $template, new DateTimeImmutable('2026-11-02 08:00:00+00:00')];
};

it('two runs of the same term create one item', function () use ($world) {
    [, , $template, $term] = $world();

    $first = RaceConnections::hold(fn () => RunTemplate::execute($template, $term, null));
    RaceConnections::releaseBeforeLock('projects');
    $second = RaceConnections::second(fn () => RunTemplate::execute(Template::query()->findOrFail($template->id), $term, null));

    expect($first['run'] ?? null)->toBeInstanceOf(TemplateRun::class)
        ->and($second)->toBeNull()
        ->and(WorkItem::query()->count())->toBe(1)
        ->and(TemplateRun::query()->count())->toBe(1)
        ->and($template->fresh()?->run_count)->toBe(1);
});

it('a run waits on the project while an item is being created there', function () use ($world) {
    [$web, $mara, $template] = $world();
    $run = fn () => RunTemplate::execute(Template::query()->findOrFail($template->id), null, null);

    RaceConnections::hold(fn () => CreateWorkItem::run(actor($mara), ['project_id' => $web->id, 'title' => 'Von Hand']));

    RaceConnections::expectLockWait(RaceConnections::second($run), 'projects');

    RaceConnections::releaseBeforeLock('projects');
    $outcome = RaceConnections::second($run);

    expect($outcome['item'] ?? null)->toBeInstanceOf(WorkItem::class)
        ->and(WorkItem::query()->orderBy('number')->pluck('title')->all())->toBe(['Von Hand', 'Wartung KW 45'])
        ->and(WorkItem::query()->pluck('number')->all())->toEqualCanonicalizing([1, 2]);
});

it('a unique violation reads as done, not as a 500', function () use ($world) {
    [, , $template, $term] = $world();
    // the row of the term is there although the template does not know it (a run that crashed after its row)
    TemplateRun::factory()->create(['template_id' => $template->id, 'scheduled_for' => $term]);

    expect(RunTemplate::execute($template, $term, null))->toBeNull()
        ->and(WorkItem::query()->count())->toBe(0)
        ->and(TemplateRun::query()->count())->toBe(1)
        ->and($template->fresh()?->run_count)->toBe(0);
});

it('a template saved while a run prepares runs with the saved payload (K16)', function () use ($world) {
    [, $mara, $template] = $world();
    test()->travelTo('2026-11-02 08:00:20.500000');

    RaceConnections::hold(fn () => SaveTemplate::run(actor($mara), null, ['name' => 'Wartung', 'payload' => ['title' => 'Neu gespeichert'], 'schedule' => null], $template));
    RaceConnections::releaseBeforeLock('projects');
    $outcome = RaceConnections::second(fn () => RunTemplate::execute(Template::query()->findOrFail($template->id), null, null));

    expect($outcome['item']->title ?? null)->toBe('Neu gespeichert')
        ->and(TemplateRun::query()->count())->toBe(1);
});

it('a run waiting on a change of the zone counts in the new zone (K3)', function () use ($world) {
    [, $mara, $template, $term] = $world();
    $template->update(['schedule_from' => '2026-11-02 07:00:00']);
    $admin = User::factory()->admin()->create();

    RaceConnections::hold(fn () => UpdateOrganization::run(actor($admin), ['timezone' => 'America/New_York']));
    RaceConnections::releaseBeforeLock('organization', 'lock in share mode');
    $outcome = RaceConnections::second(function () use ($template, $term) {
        // the run read the organisation before the change (a job started before it)
        app()->instance(Organization::class, Organization::query()->sole());

        return RunTemplate::execute(Template::query()->findOrFail($template->id), $term, null);
    });

    // in New York 09:00 is 14:00 UTC: no run for the term of the old calendar, the next one on the new
    expect($outcome)->toBeNull()
        ->and(TemplateRun::query()->count())->toBe(0)
        ->and($template->fresh()?->next_run_at?->toJSON())->toBe('2026-11-02T14:00:00.000000Z');
});

it('a run by hand waiting on a change of the zone takes its day from the new zone (K3)', function () use ($world) {
    [, , $template] = $world();
    $template->update(['payload' => [...$template->payload, 'title' => 'Wartung {date}']]);
    // 00:30 of 2026-11-02 in Berlin, still 18:30 of 2026-11-01 in New York
    test()->travelTo('2026-11-01 23:30:00');
    $admin = User::factory()->admin()->create();

    RaceConnections::hold(fn () => UpdateOrganization::run(actor($admin), ['timezone' => 'America/New_York']));
    RaceConnections::releaseBeforeLock('organization', 'lock in share mode');
    $outcome = RaceConnections::second(function () use ($template) {
        app()->instance(Organization::class, Organization::query()->sole());

        return RunTemplate::execute(Template::query()->findOrFail($template->id), null, null);
    });

    expect($outcome['item']->title ?? null)->toBe('Wartung 2026-11-01');
});
