<?php

use App\Actions\Organization\UpdateOrganization;
use App\Actions\Templates\RescheduleTemplates;
use App\Actions\Templates\RunDueTemplates;
use App\Events\EventType;
use App\Models\Event;
use App\Models\Organization;
use App\Models\Project;
use App\Models\Template;
use App\Models\TemplateRun;
use App\Models\User;
use App\Support\Actor;
use Illuminate\Support\Facades\Storage;

// A new time zone of the organisation (A339, K3): every schedule counts anew from the moment of the change, on the new
// calendar, and no term of the old calendar runs after the fact.

beforeEach(function () {
    Storage::fake('local');
    Organization::current()->update(['timezone' => 'Europe/Berlin', 'locale' => 'de']);
});

$daily = ['frequency' => 'daily', 'interval' => 1, 'time' => '09:00', 'starts_on' => '2026-10-26', 'ends' => ['type' => 'never']];

$tick = fn (): int => RunDueTemplates::run(Actor::system(User::defaultBot(), 'templates'), true);

it('moves next_run_at when the organisation changes its zone and runs no extra term of the old calendar', function () use ($daily, $tick) {
    $admin = User::factory()->admin()->create();
    $web = Project::factory()->identifier('WEB')->create();
    $this->travelTo('2026-11-01 12:00:00');
    $template = Template::factory()->scheduled($daily)->create(['project_id' => $web->id]);
    $plain = Template::factory()->create(['project_id' => $web->id]);

    // the term of 09:00 Berlin ran today
    $this->travelTo('2026-11-02 08:00:30');
    expect($tick())->toBe(1);

    // 16:00 in Berlin is 10:00 in New York: today's term of 09:00 New York (14:00 UTC) is before the change
    $this->travelTo('2026-11-02 15:00:00');
    $events = Event::query()->count();
    UpdateOrganization::run(actor($admin), ['timezone' => 'America/New_York']);

    $fresh = $template->fresh();
    expect($fresh?->schedule_from?->toJSON())->toBe('2026-11-02T15:00:00.000000Z')
        ->and($fresh?->next_run_at?->toJSON())->toBe('2026-11-03T14:00:00.000000Z')
        ->and([$plain->fresh()?->schedule_from, $plain->fresh()?->next_run_at])->toBe([null, null])
        // the organisation writes its event, the templates none of their own
        ->and(Event::query()->count())->toBe($events + 1)
        ->and(eventsOf(EventType::OrganizationUpdated)->last()?->changes)->toHaveKey('timezone');

    $fresh?->update(['next_run_at' => '2026-11-02 14:00:00']);
    expect($tick())->toBe(1)
        ->and(TemplateRun::query()->pluck('scheduled_for')->map->toJSON()->all())->toBe(['2026-11-02T08:00:00.000000Z']);

    $this->travelTo('2026-11-03 14:00:30');
    $tick();
    expect(TemplateRun::query()->orderBy('scheduled_for')->pluck('scheduled_for')->map->toJSON()->all())->toBe(['2026-11-02T08:00:00.000000Z', '2026-11-03T14:00:00.000000Z']);
});

it('leaves the schedules alone when the zone stays', function () use ($daily) {
    $admin = User::factory()->admin()->create();
    $this->travelTo('2026-11-01 12:00:00');
    $template = Template::factory()->scheduled($daily)->create();

    $this->travelTo('2026-11-01 13:00:00');
    UpdateOrganization::run(actor($admin), ['timezone' => 'Europe/Berlin', 'name' => 'Feldwerk GmbH']);

    expect($template->fresh()?->schedule_from?->toJSON())->toBe('2026-11-01T12:00:00.000000Z');
});

it('counts every template with a schedule, a paused one included, and keeps updated_at', function () use ($daily) {
    $this->travelTo('2026-11-01 12:00:00');
    $running = Template::factory()->scheduled($daily)->create();
    $paused = Template::factory()->scheduled([...$daily, 'paused' => true])->create();
    Template::factory()->create();
    $stamp = $running->fresh()?->getRawOriginal('updated_at');

    $this->travelTo('2026-11-01 13:00:00');
    expect(RescheduleTemplates::run(Actor::system(User::defaultBot(), 'timezone'), 'Asia/Kolkata'))->toBe(2)
        // 09:00 in Kolkata is 03:30 UTC
        ->and($running->fresh()?->next_run_at?->toJSON())->toBe('2026-11-02T03:30:00.000000Z')
        ->and($running->fresh()?->getRawOriginal('updated_at'))->toBe($stamp)
        ->and([$paused->fresh()?->schedule_from?->toJSON(), $paused->fresh()?->next_run_at])->toBe(['2026-11-01T13:00:00.000000Z', null]);
});
