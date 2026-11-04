<?php

use App\Access\Visibility;
use App\Domain\Automations\AutomationKey;
use App\Domain\Schedule\Frequency;
use App\Models\Attachment;
use App\Models\Automation;
use App\Models\Organization;
use App\Models\Project;
use App\Models\Template;
use App\Models\TemplateRun;
use App\Models\User;
use App\Models\WorkItem;
use Carbon\CarbonImmutable;
use Illuminate\Database\UniqueConstraintViolationException;
use Illuminate\Support\Facades\Storage;

// Templates, their runs and the automations of a project as stored (spec 4.12, 4.13, plan "Datenmodell").

/** A weekly schedule on Monday at 09:00 from 2026-10-26 on, in the normal form. */
$weekly = fn (): array => [
    'frequency' => 'weekly', 'interval' => 1, 'weekdays' => [1], 'time' => '09:00', 'starts_on' => '2026-10-26',
    'ends' => ['type' => 'never'], 'paused' => false,
];

it('keeps one run per template and term, and any number of manual runs', function () {
    $template = Template::factory()->create();
    TemplateRun::factory()->count(2)->create(['template_id' => $template->id, 'scheduled_for' => null]);
    TemplateRun::factory()->create(['template_id' => $template->id, 'scheduled_for' => '2026-11-02 08:00:00']);

    expect($template->runs()->count())->toBe(3);

    TemplateRun::factory()->create(['template_id' => $template->id, 'scheduled_for' => '2026-11-02 08:00:00']);
})->throws(UniqueConstraintViolationException::class);

it('takes templates, runs and automations with the project', function () {
    $project = Project::factory()->create();
    $other = Template::factory()->create();
    $template = Template::factory()->create(['project_id' => $project->id]);
    $item = WorkItem::factory()->create(['project_id' => $project->id, 'template_id' => $template->id]);
    TemplateRun::factory()->create(['template_id' => $template->id, 'work_item_id' => $item->id]);
    Automation::factory()->for($project)->key(AutomationKey::CloseParent)->enabled()->create();

    $project->delete();

    expect(Template::query()->pluck('id')->all())->toBe([$other->id])
        ->and(TemplateRun::query()->count())->toBe(0)
        ->and(Automation::query()->count())->toBe(0)
        ->and(WorkItem::query()->find($item->id))->toBeNull();
});

it('keeps the item when its template goes, and the run when its item goes', function () {
    $template = Template::factory()->create();
    $item = WorkItem::factory()->create(['project_id' => $template->project_id, 'template_id' => $template->id]);
    $other = WorkItem::factory()->create(['project_id' => $template->project_id]);
    $run = TemplateRun::factory()->create(['template_id' => Template::factory()->create()->id, 'work_item_id' => $other->id]);

    $template->delete();
    $other->delete();

    expect($item->fresh()?->template_id)->toBeNull()
        ->and($run->fresh()?->work_item_id)->toBeNull();
});

it('keeps one automation per project and key', function () {
    $project = Project::factory()->create();
    Automation::factory()->for($project)->key(AutomationKey::AutoArchive)->create();
    Automation::factory()->for($project)->key(AutomationKey::AutoClose)->create();
    Automation::factory()->for(Project::factory())->key(AutomationKey::AutoArchive)->create();

    expect(Automation::query()->count())->toBe(3);

    Automation::factory()->for($project)->key(AutomationKey::AutoArchive)->create();
})->throws(UniqueConstraintViolationException::class);

it('starts an automation off with the settings of its key, and on with others merged in', function () {
    $project = Project::factory()->create();
    $off = Automation::factory()->for($project)->key(AutomationKey::AutoClose)->create();
    $on = Automation::factory()->for($project)->key('auto_archive')->enabled(['days' => 7])->create()->fresh();

    expect($off->enabled)->toBeFalse()
        ->and($off->settings)->toBe(['days' => 90, 'state_id' => null])
        ->and($on?->key)->toBe(AutomationKey::AutoArchive)
        ->and($on?->enabled)->toBeTrue()
        ->and($on?->settings)->toBe(['days' => 7])
        ->and($on?->project->is($project))->toBeTrue()
        ->and(Automation::factory()->make()->key)->toBe(AutomationKey::AutoArchive);
});

it('makes a template of the default type with placeholders, created by a member, without a schedule', function () {
    $template = Template::factory()->create()->fresh() ?? throw new RuntimeException('gone');

    expect($template->payload)->toBe([
        'type_id' => $template->project->default_type_id, 'title' => 'Wartung KW {week}', 'description' => null,
        'priority' => 'none', 'assignee_id' => null, 'label_ids' => [], 'values' => [], 'parent_id' => null,
        'start_offset_days' => null, 'due_offset_days' => null,
    ])
        ->and($template->schedule)->toBeNull()
        ->and($template->schedule())->toBeNull()
        ->and($template->next_run_at)->toBeNull()
        ->and($template->run_count)->toBe(0)
        ->and($template->creator->is($template->project->memberships()->orderBy('id')->firstOrFail()->user))->toBeTrue();
});

it('makes a scheduled template that counts from now, in the zone of the organisation', function () use ($weekly) {
    Organization::current()->update(['timezone' => 'America/New_York']);
    $this->travelTo(CarbonImmutable::parse('2026-10-28 09:00:00.250000', 'UTC'));

    $template = Template::factory()->scheduled($weekly())->create()->fresh() ?? throw new RuntimeException('gone');

    expect($template->schedule)->toBe($weekly())
        ->and($template->schedule()?->frequency)->toBe(Frequency::Weekly)
        ->and($template->schedule_from?->format('Y-m-d H:i:s.u'))->toBe('2026-10-28 09:00:00.250000')
        // Monday 2026-11-02 09:00 in New York (EST since 1 November) is 14:00 UTC
        ->and($template->next_run_at?->format('Y-m-d H:i:s'))->toBe('2026-11-02 14:00:00')
        ->and($template->last_run_at)->toBeNull();
});

it('reads a stored schedule it cannot read any more as none', function () use ($weekly) {
    $template = Template::factory()->create(['schedule' => [...$weekly(), 'time' => '25:00']]);

    expect($template->schedule())->toBeNull();
});

it('lists its runs newest first and knows their item and trigger', function () {
    $template = Template::factory()->create();
    $person = User::factory()->create();
    $item = WorkItem::factory()->create(['project_id' => $template->project_id, 'template_id' => $template->id]);
    $older = TemplateRun::factory()->create(['template_id' => $template->id, 'ran_at' => '2026-11-02 08:00:00.100000']);
    $newer = TemplateRun::factory()->create([
        'template_id' => $template->id, 'ran_at' => '2026-11-02 08:00:00.200000', 'work_item_id' => $item->id, 'triggered_by' => $person->id,
    ]);
    $failed = TemplateRun::factory()->failed('Assignee ist kein Mitglied mehr.')->create(['template_id' => $template->id, 'ran_at' => '2026-11-01 08:00:00']);

    expect($template->runs->pluck('id')->all())->toBe([$newer->id, $older->id, $failed->id])
        ->and($newer->template->is($template))->toBeTrue()
        ->and($newer->workItem?->is($item))->toBeTrue()
        ->and($newer->trigger?->is($person))->toBeTrue()
        ->and($older->trigger)->toBeNull()
        ->and($newer->fresh()?->ran_at?->format('u'))->toBe('200000')
        ->and($failed->status)->toBe(TemplateRun::FAILED)
        ->and($failed->error)->toBe('Assignee ist kein Mitglied mehr.')
        ->and($older->status)->toBe(TemplateRun::CREATED)
        ->and($item->template?->is($template))->toBeTrue();
});

it('owns the images of its description', function () {
    Storage::fake('local');
    $template = Template::factory()->create();
    $image = Attachment::factory()->create([
        'project_id' => $template->project_id, 'attachable_type' => $template->getMorphClass(), 'attachable_id' => $template->id, 'kind' => 'inline',
    ]);

    expect($template->attachments->pluck('id')->all())->toBe([$image->id]);
});

it('shows the templates of the projects the account sees, none of a project being deleted', function () {
    $person = User::factory()->create();
    $public = Project::factory()->public()->create();
    $private = Project::factory()->private()->create();
    $deleting = Project::factory()->public()->create(['deleting_at' => now()]);
    $seen = Template::factory()->create(['project_id' => $public->id]);
    Template::factory()->create(['project_id' => $private->id]);
    Template::factory()->create(['project_id' => $deleting->id]);
    Visibility::forget();

    expect(Template::query()->visibleTo($person)->pluck('id')->all())->toBe([$seen->id]);
});
