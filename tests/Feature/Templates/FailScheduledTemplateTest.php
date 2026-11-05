<?php

use App\Access\ProjectRole;
use App\Actions\Templates\FailScheduledTemplate;
use App\Actions\Templates\RunDueTemplates;
use App\Events\EventType;
use App\Jobs\RunTemplateJob;
use App\Models\Organization;
use App\Models\Project;
use App\Models\Template;
use App\Models\TemplateRun;
use App\Models\User;
use App\Models\WorkItem;
use App\Support\Actor;
use Illuminate\Database\Events\QueryExecuted;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Storage;

// A template whose run keeps crashing (an exception that is no refusal of a field, T8-M2): once the job of its term has
// used up its tries, the term is booked as a failed run like a template that is not valid any more, so the sweeper
// moves on to the next term instead of queueing the same one again every five minutes, and lead and author hear of it.

beforeEach(function () {
    Storage::fake('local');
    Organization::current()->update(['timezone' => 'Europe/Berlin', 'locale' => 'de']);
});

/** WEB with Mara as admin and lead, a template of hers every day at 09:00, set on Sunday 2026-11-01; now Monday 09:00:30. */
$world = function (): array {
    $mara = User::factory()->create(['name' => 'Mara', 'handle' => 'mara']);
    $web = Project::factory()->identifier('WEB')->public()->member($mara, ProjectRole::Admin)->create(['lead_id' => $mara->id]);
    test()->travelTo('2026-11-01 12:00:00');
    $template = Template::factory()->scheduled(['frequency' => 'daily', 'interval' => 1, 'time' => '09:00', 'starts_on' => '2026-10-26', 'ends' => ['type' => 'never']])
        ->create(['project_id' => $web->id, 'created_by' => $mara->id]);
    test()->travelTo('2026-11-02 08:00:30');

    return [$web, $mara, $template];
};

/** Every item the run makes crashes, like a bug or a broken database would. */
$crash = fn () => DB::listen(function (QueryExecuted $query): void {
    if (str_starts_with($query->sql, 'insert into `work_items`')) {
        throw new RuntimeException('boom');
    }
});

$tick = fn (): int => RunDueTemplates::run(Actor::system(User::defaultBot(), 'templates'), true, null, fn () => null);

it('books the term of a crashing run as failed once the job gave up, and the sweeper moves on', function () use ($world, $crash, $tick) {
    [$web, $mara, $template] = $world();
    $crash();
    $job = new RunTemplateJob($template->id);

    expect(fn () => $job->handle())->toThrow(RuntimeException::class, 'boom');
    expect(TemplateRun::query()->count())->toBe(0);

    $job->failed(new RuntimeException('boom'));

    $run = TemplateRun::query()->sole();
    $template->refresh();
    expect([$run->status, $run->scheduled_for?->toJSON(), $run->work_item_id, $run->triggered_by])
        ->toBe([TemplateRun::FAILED, '2026-11-02T08:00:00.000000Z', null, null])
        // a sentence for people, never the message of the exception
        ->and($run->error)->toBe('Interner Fehler beim Anlegen des Items')
        ->and([$template->run_count, $template->last_run_at?->toJSON(), $template->next_run_at?->toJSON()])
        ->toBe([1, '2026-11-02T08:00:00.000000Z', '2026-11-03T08:00:00.000000Z'])
        ->and(WorkItem::query()->count())->toBe(0);

    $event = eventsOf(EventType::TemplateRunFailed, $template)->sole();
    expect([$event->actor_id, $event->project_id, $event->meta])->toBe([User::defaultBot()->id, $web->id, [
        'via' => 'template', 'reason' => 'template',
        'run_id' => $run->id, 'error' => 'Interner Fehler beim Anlegen des Items', 'scheduled_for' => '2026-11-02T08:00:00.000000Z', 'author_id' => $mara->id,
    ]]);

    // the term is done: the sweeper leaves the template alone until tomorrow
    expect($tick())->toBe(0);
    $job->failed(new RuntimeException('boom'));
    expect(TemplateRun::query()->count())->toBe(1);
});

it('writes the sentence in the language of the organisation', function () use ($world) {
    [, , $template] = $world();
    Organization::current()->update(['locale' => 'en']);

    (new RunTemplateJob($template->id))->failed(new RuntimeException('boom'));

    expect(TemplateRun::query()->sole()->error)->toBe('Internal error while creating the item');
});

it('only notes the term when a run of it is already there', function () use ($world) {
    [, , $template] = $world();
    // a run of the term without its bookkeeping (should it ever be so)
    TemplateRun::query()->create(['template_id' => $template->id, 'scheduled_for' => '2026-11-02 08:00:00', 'ran_at' => now(), 'status' => TemplateRun::CREATED]);

    expect(FailScheduledTemplate::run(Actor::system(User::defaultBot(), 'templates'), $template->id))->toBeNull();

    $template->refresh();
    expect(TemplateRun::query()->count())->toBe(1)
        ->and([$template->run_count, $template->last_run_at?->toJSON(), $template->next_run_at?->toJSON()])
        ->toBe([0, '2026-11-02T08:00:00.000000Z', '2026-11-03T08:00:00.000000Z'])
        ->and(eventsOf(EventType::TemplateRunFailed))->toHaveCount(0);
});

it('books nothing without a due term, without the template and in a project archived or being deleted', function () use ($world) {
    [$web, , $template] = $world();
    $fail = fn () => FailScheduledTemplate::run(Actor::system(User::defaultBot(), 'templates'), $template->id);

    // before the term
    $this->travelTo('2026-11-02 07:59:00');
    expect($fail())->toBeNull();

    $this->travelTo('2026-11-02 08:00:30');
    $web->forceFill(['archived_at' => now()])->save();
    expect($fail())->toBeNull();

    $web->forceFill(['archived_at' => null, 'deleting_at' => now()])->save();
    expect($fail())->toBeNull();

    $web->forceFill(['deleting_at' => null])->save();
    $paused = $template->schedule;
    $template->forceFill(['schedule' => [...$paused, 'paused' => true]])->save();
    expect($fail())->toBeNull();

    expect(FailScheduledTemplate::run(Actor::system(User::defaultBot(), 'templates'), '01arz3ndektsv4rrffq69g5fav'))->toBeNull()
        ->and(TemplateRun::query()->count())->toBe(0)
        ->and(eventsOf(EventType::TemplateRunFailed))->toHaveCount(0);
});
