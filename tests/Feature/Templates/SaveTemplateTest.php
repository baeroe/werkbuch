<?php

use App\Access\ProjectRole;
use App\Actions\Templates\SaveTemplate;
use App\Domain\Properties\FieldType;
use App\Events\EventType;
use App\Http\Resources\TemplateResource;
use App\Models\Attachment;
use App\Models\Label;
use App\Models\Organization;
use App\Models\Project;
use App\Models\Property;
use App\Models\Template;
use App\Models\User;
use App\Models\WorkItem;
use App\Models\WorkItemType;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Storage;
use Illuminate\Support\Str;

// Creating and replacing templates (spec 4.12, A75, A339, A349, K5): every field checked like the fields of a new item
// without required values, the schedule in its normal form and the next run worked out on the calendar of the
// organisation.

/** WEB with Mara as its admin and lead, Lene as a viewer. */
$world = function (): array {
    Organization::current()->update(['timezone' => 'Europe/Berlin']);
    $mara = User::factory()->create(['name' => 'Mara', 'handle' => 'mara']);
    $web = Project::factory()->identifier('WEB')->public()->member($mara, ProjectRole::Admin)->create(['lead_id' => $mara->id]);
    $lene = memberOf($web, ProjectRole::Viewer, ['name' => 'Lene', 'handle' => 'lene']);

    return [$web, $mara, $lene];
};

/** The schedule of „Monatsbericht“ (workspace.ts): the first Monday of each month at 09:00. */
$firstMonday = fn (array $changes = []): array => [
    'frequency' => 'monthly', 'interval' => 1, 'nth_weekday' => ['n' => 1, 'weekday' => 1], 'time' => '09:00',
    'starts_on' => '2026-09-01', 'ends' => ['type' => 'never'], 'paused' => false, ...$changes,
];

$task = fn (): WorkItemType => WorkItemType::query()->where('name', 'Task')->firstOrFail();

/** A property the type asks for, at the end of its list. */
$askFor = function (WorkItemType $type, Property $property, bool $required = false): Property {
    $type->typeProperties()->create(['property_id' => $property->id, 'required' => $required, 'position' => $type->typeProperties()->count()]);

    return $property;
};

it('creates a template with schedule and works out its next run', function () use ($world, $firstMonday, $task) {
    [$web, $mara] = $world();
    $this->travelTo('2026-10-28 09:00:00');

    $template = SaveTemplate::run(actor($mara), $web, [
        'name' => '  Monatsbericht ',
        'payload' => ['title' => ' Monatsbericht {month_name} {year} ', 'description' => 'Kennzahlen des Monats', 'priority' => 'medium', 'assignee_id' => strtoupper($mara->id)],
        'schedule' => $firstMonday(),
    ]);

    expect($template->name)->toBe('Monatsbericht')
        ->and($template->payload)->toBe([
            'type_id' => $task()->id,
            'title' => 'Monatsbericht {month_name} {year}',
            'description' => ['type' => 'doc', 'content' => [['type' => 'paragraph', 'content' => [['type' => 'text', 'text' => 'Kennzahlen des Monats']]]]],
            'priority' => 'medium',
            'assignee_id' => $mara->id,
            'label_ids' => [],
            'values' => [],
            'parent_id' => null,
            'start_offset_days' => null,
            'due_offset_days' => null,
        ])
        ->and($template->schedule)->toBe($firstMonday())
        ->and($template->next_run_at?->utc()->format('Y-m-d H:i:s'))->toBe('2026-11-02 08:00:00')
        ->and($template->schedule_from?->utc()->format('Y-m-d H:i:s'))->toBe('2026-10-28 09:00:00')
        ->and($template->last_run_at)->toBeNull()
        ->and($template->run_count)->toBe(0)
        ->and($template->created_by)->toBe($mara->id)
        ->and($template->wasRecentlyCreated)->toBeTrue();

    $event = eventsOf(EventType::TemplateCreated, $template)->sole();
    expect($event->changes)->toBe(['name' => ['old' => null, 'new' => 'Monatsbericht']])
        ->and($event->project_id)->toBe($web->id);
});

it('counts the next run in the zone of the organisation', function () use ($world, $firstMonday) {
    [$web, $mara] = $world();
    Organization::current()->update(['timezone' => 'America/New_York']);
    $this->travelTo('2026-10-28 09:00:00');

    $template = SaveTemplate::run(actor($mara), $web->identifier, ['name' => 'Bericht', 'payload' => ['title' => 'Bericht'], 'schedule' => $firstMonday()]);

    expect($template->next_run_at?->utc()->format('Y-m-d H:i'))->toBe('2026-11-02 14:00');
});

it('takes the project by a reference and refuses an unknown one with 404', function () use ($world) {
    [, $mara] = $world();

    expect(SaveTemplate::run(actor($mara), 'web', ['name' => 'A', 'payload' => ['title' => 'A'], 'schedule' => null])->schedule)->toBeNull()
        ->and(problemOf(fn () => SaveTemplate::run(actor($mara), 'NOPE', ['name' => 'A', 'payload' => ['title' => 'A'], 'schedule' => null]))->status)->toBe(404)
        ->and(problemOf(fn () => SaveTemplate::run(actor($mara), null, ['name' => 'A', 'payload' => ['title' => 'A'], 'schedule' => null]))->status)->toBe(404);
});

it('refuses every field at once', function () use ($world) {
    [$web, $mara] = $world();
    $off = WorkItemType::factory()->create(['name' => 'Aus']);

    $errors = invalidOf(fn () => SaveTemplate::run(actor($mara), $web, [
        'name' => ' ',
        'payload' => ['type_id' => $off->id, 'title' => 'A', 'label_ids' => [strtolower((string) Str::ulid())]],
        'schedule' => ['frequency' => 'daily', 'interval' => 1, 'time' => '25:00', 'starts_on' => '2026-11-01', 'ends' => ['type' => 'never']],
    ]));

    expect($errors)->toBe([
        'name' => [__('field.name.required')],
        'payload.type_id' => [__('field.type_id.disabled')],
        'payload.label_ids' => [__('field.label_ids.unknown')],
        'schedule.time' => [__('field.schedule.time')],
    ])
        ->and(Template::query()->count())->toBe(0);
});

it('requires name, payload and schedule, and payload as an object', function () use ($world) {
    [$web, $mara] = $world();

    expect(invalidOf(fn () => SaveTemplate::run(actor($mara), $web, [])))->toBe([
        'name' => [__('field.required')],
        'payload' => [__('field.required')],
        'schedule' => [__('field.required')],
    ])
        ->and(invalidOf(fn () => SaveTemplate::run(actor($mara), $web, ['name' => ['x'], 'payload' => ['a', 'b'], 'schedule' => null])))->toBe([
            'name' => [__('field.name.invalid')],
            'payload' => [__('field.payload.invalid')],
        ])
        ->and(invalidOf(fn () => SaveTemplate::run(actor($mara), $web, ['name' => str_repeat('n', 121), 'payload' => [], 'schedule' => null])))->toBe([
            'name' => [__('field.name.max', ['max' => 120])],
            'payload.title' => [__('field.title.required')],
        ]);
});

it('names each field of the payload at its path', function () use ($world, $task, $askFor) {
    [$web, $mara] = $world();
    $askFor($task(), Property::factory()->create(['key' => 'budget', 'label' => 'Budget', 'field_type' => FieldType::Number]));
    $stranger = User::factory()->create();
    $other = Project::factory()->identifier('APP')->member($mara, ProjectRole::Member)->create();
    $elsewhere = WorkItem::factory()->for($other)->epic()->create();

    $errors = invalidOf(fn () => SaveTemplate::run(actor($mara), $web, [
        'name' => 'A',
        'payload' => [
            'title' => str_repeat('t', 256),
            'description' => 'Text',
            'description_json' => ['type' => 'doc'],
            'priority' => 'sofort',
            'assignee_id' => $stranger->id,
            'parent_id' => 'APP-1',
            'values' => ['budget' => 'viel', 'colour' => 'blau'],
            'start_offset_days' => -1,
            'due_offset_days' => 3651,
        ],
        'schedule' => null,
    ]));

    expect($elsewhere->key)->toBe('APP-1')
        ->and($errors)->toBe([
            'payload.description' => [__('field.rich_text.both')],
            'payload.title' => [__('field.title.max', ['max' => 255])],
            'payload.priority' => [__('field.priority.invalid')],
            'payload.assignee_id' => [__('field.assignee_id.invalid')],
            'payload.parent_id' => [__('field.parent_id.project')],
            'payload.values.budget' => [__('field.values.number', ['label' => 'Budget'])],
            'payload.values.colour' => [__('field.values.unknown', ['key' => 'colour', 'type' => 'Task'])],
            'payload.start_offset_days' => [__('field.offset.invalid', ['max' => 3650])],
            'payload.due_offset_days' => [__('field.offset.invalid', ['max' => 3650])],
        ]);
});

it('keeps the due offset at or after the start offset', function () use ($world) {
    [$web, $mara] = $world();
    $save = fn (array $payload) => SaveTemplate::run(actor($mara), $web, ['name' => 'A', 'payload' => ['title' => 'A', ...$payload], 'schedule' => null]);

    expect(invalidOf(fn () => $save(['start_offset_days' => 5, 'due_offset_days' => 4])))->toBe([
        'payload.due_offset_days' => [__('field.due_offset.before_start')],
    ])
        ->and(invalidOf(fn () => $save(['start_offset_days' => '1', 'due_offset_days' => 1.5])))->toBe([
            'payload.start_offset_days' => [__('field.offset.invalid', ['max' => 3650])],
            'payload.due_offset_days' => [__('field.offset.invalid', ['max' => 3650])],
        ])
        ->and($save(['start_offset_days' => 0, 'due_offset_days' => 3650])->payload)->toMatchArray(['start_offset_days' => 0, 'due_offset_days' => 3650])
        ->and($save(['due_offset_days' => 7])->payload)->toMatchArray(['start_offset_days' => null, 'due_offset_days' => 7]);
});

it('takes an epic of the project as the parent of a task, and refuses the two levels otherwise', function () use ($world) {
    [$web, $mara] = $world();
    $epic = WorkItem::factory()->for($web)->epic()->create();
    $task = WorkItem::factory()->for($web)->create();
    $epicType = WorkItemType::query()->where('name', 'Epic')->firstOrFail();
    $save = fn (array $payload) => SaveTemplate::run(actor($mara), $web, ['name' => 'A', 'payload' => ['title' => 'A', ...$payload], 'schedule' => null]);

    expect($save(['parent_id' => 'web-1'])->payload['parent_id'])->toBe($epic->id)
        ->and(invalidOf(fn () => $save(['parent_id' => $task->key])))->toBe(['payload.parent_id' => [__('problem.reason.parent_not_epic')]])
        ->and(invalidOf(fn () => $save(['type_id' => $epicType->id, 'parent_id' => $epic->id])))->toBe(['payload.parent_id' => [__('problem.reason.epic_has_no_parent')]])
        ->and(invalidOf(fn () => $save(['parent_id' => 'WEB-99'])))->toBe(['payload.parent_id' => [__('field.parent_id.unknown')]]);
});

it('allows a required property without a value', function () use ($world, $task, $askFor) {
    [$web, $mara] = $world();
    $askFor($task(), Property::factory()->create(['key' => 'customer', 'label' => 'Kunde']), true);
    $askFor($task(), Property::factory()->create(['key' => 'notes', 'label' => 'Notizen', 'field_type' => FieldType::RichText]));
    $askFor($task(), Property::factory()->create(['key' => 'channel', 'label' => 'Kanal', 'default_value' => 'Web']));

    $template = SaveTemplate::run(actor($mara), $web, ['name' => 'A', 'payload' => ['title' => 'A', 'values' => ['customer' => ' ', 'notes' => 'Hallo @mara']], 'schedule' => null]);
    $notes = $template->payload['values']['notes'];

    // no default value either: the run takes it (the template stores only what it names)
    expect(array_keys($template->payload['values']))->toBe(['notes'])
        ->and($notes['content'][0]['content'][1])->toMatchArray(['type' => 'mention', 'attrs' => ['id' => $mara->id, 'label' => 'mara', 'mentionSuggestionChar' => '@']]);
});

it('refuses a title that placeholders would make longer than 255', function () use ($world) {
    [$web, $mara] = $world();
    $save = fn (string $title) => SaveTemplate::run(actor($mara), $web, ['name' => 'A', 'payload' => ['title' => $title], 'schedule' => null]);

    // `{date}` is six characters and fills ten
    expect(invalidOf(fn () => $save(str_repeat('x', 246).'{date}')))->toBe(['payload.title' => [__('field.title.max', ['max' => 255])]])
        ->and($save(str_repeat('x', 245).'{date}')->payload['title'])->toHaveLength(251);
});

it('names the codes of a schedule at their fields', function () use ($world, $firstMonday) {
    [$web, $mara] = $world();
    $save = fn (mixed $schedule) => invalidOf(fn () => SaveTemplate::run(actor($mara), $web, ['name' => 'A', 'payload' => ['title' => 'A'], 'schedule' => $schedule]));

    expect($save('monthly'))->toBe(['schedule' => [__('field.schedule.shape')]])
        ->and($save($firstMonday(['frequency' => 'hourly', 'interval' => 0, 'paused' => 'no', 'starts_on' => '1999-12-31', 'ends' => ['type' => 'count', 'count' => 0]])))->toBe([
            'schedule.frequency' => [__('field.schedule.frequency')],
            'schedule.interval' => [__('field.schedule.interval', ['max' => 999])],
            'schedule.starts_on' => [__('field.schedule.range', ['first' => '2000-01-01', 'last' => '2099-12-31'])],
            'schedule.ends' => [__('field.schedule.ends', ['max' => 9999])],
            'schedule.paused' => [__('field.boolean')],
        ])
        ->and($save($firstMonday(['nth_weekday' => ['n' => 5, 'weekday' => 1]])))->toBe(['schedule.nth_weekday' => [__('field.schedule.nth_weekday')]])
        ->and($save([...$firstMonday(['nth_weekday' => null]), 'month_day' => 32]))->toBe(['schedule.month_day' => [__('field.schedule.month_day')]])
        ->and($save($firstMonday(['frequency' => 'weekly', 'weekdays' => [7]])))->toBe(['schedule.weekdays' => [__('field.schedule.weekdays')]])
        ->and($save($firstMonday(['frequency' => 'yearly', 'yearly_date' => '02-30'])))->toBe(['schedule.yearly_date' => [__('field.schedule.yearly_date')]])
        ->and($save($firstMonday(['starts_on' => '2026-02-30', 'ends' => ['type' => 'on', 'date' => '2100-01-01']])))->toBe([
            'schedule.starts_on' => [__('field.schedule.starts_on')],
            'schedule.ends' => [__('field.schedule.range', ['first' => '2000-01-01', 'last' => '2099-12-31'])],
        ]);
});

it('refuses a schedule without a single term, paused or not', function () use ($world) {
    [$web, $mara] = $world();
    // Mondays only, from a Tuesday to the Sunday after it
    $never = ['frequency' => 'weekly', 'interval' => 1, 'weekdays' => [1], 'time' => '09:00', 'starts_on' => '2026-11-03', 'ends' => ['type' => 'on', 'date' => '2026-11-08']];
    $save = fn (array $schedule) => SaveTemplate::run(actor($mara), $web, ['name' => 'A', 'payload' => ['title' => 'A'], 'schedule' => $schedule]);

    expect(invalidOf(fn () => $save($never)))->toBe(['schedule' => [__('field.schedule.never_runs')]])
        ->and(invalidOf(fn () => $save([...$never, 'paused' => true])))->toBe(['schedule' => [__('field.schedule.never_runs')]])
        ->and($save([...$never, 'ends' => ['type' => 'on', 'date' => '2026-11-09']])->schedule['ends'])->toBe(['type' => 'on', 'date' => '2026-11-09']);
});

it('keeps a schedule paused without next run', function () use ($world, $firstMonday) {
    [$web, $mara] = $world();
    $this->travelTo('2026-10-28 09:00:00');

    $template = SaveTemplate::run(actor($mara), $web, ['name' => 'A', 'payload' => ['title' => 'A'], 'schedule' => $firstMonday(['paused' => true])]);

    expect($template->schedule['paused'])->toBeTrue()
        ->and($template->next_run_at)->toBeNull()
        ->and(SaveTemplate::run(actor($mara), $web, ['name' => 'B', 'payload' => ['title' => 'B'], 'schedule' => null])->only(['schedule', 'schedule_from', 'next_run_at']))
        ->toBe(['schedule' => null, 'schedule_from' => null, 'next_run_at' => null]);
});

it('sets schedule_from when the schedule changes or resumes, not when only the name changes', function () use ($world, $firstMonday) {
    [$web, $mara] = $world();
    $this->travelTo('2026-10-28 09:00:00');
    $paused = SaveTemplate::run(actor($mara), $web, ['name' => 'A', 'payload' => ['title' => 'A'], 'schedule' => $firstMonday(['paused' => true])]);
    $paused->update(['run_count' => 2, 'last_run_at' => '2026-10-05 07:00:00']);
    $save = fn (string $name, ?array $schedule) => SaveTemplate::run(actor($mara), null, ['name' => $name, 'payload' => ['title' => 'A'], 'schedule' => $schedule], $paused->fresh());
    $from = fn (Template $t): ?string => $t->schedule_from?->utc()->format('Y-m-d H:i:s');

    $this->travelTo('2026-11-10 10:00:00');
    $renamed = $save('B', $firstMonday(['paused' => true]));
    $this->travelTo('2026-11-11 10:00:00');
    $resumed = $save('B', $firstMonday());
    $this->travelTo('2026-11-12 10:00:00');
    $kept = $save('C', $firstMonday());
    $moved = $save('C', $firstMonday(['time' => '10:00']));
    $dropped = $save('C', null);

    // resuming never catches up the Monday of 2 November that the pause missed
    expect([$from($renamed), $renamed->next_run_at])->toBe(['2026-10-28 09:00:00', null])
        ->and([$from($resumed), $resumed->next_run_at?->utc()->format('Y-m-d H:i')])->toBe(['2026-11-11 10:00:00', '2026-12-07 08:00'])
        ->and([$from($kept), $kept->next_run_at?->utc()->format('Y-m-d H:i')])->toBe(['2026-11-11 10:00:00', '2026-12-07 08:00'])
        ->and([$from($moved), $moved->next_run_at?->utc()->format('Y-m-d H:i')])->toBe(['2026-11-12 10:00:00', '2026-12-07 09:00'])
        ->and([$dropped->schedule_from, $dropped->next_run_at, $dropped->run_count, $dropped->last_run_at?->utc()->format('Y-m-d H:i')])->toBe([null, null, 2, '2026-10-05 07:00'])
        ->and(eventsOf(EventType::TemplateUpdated, $paused)->map(fn ($e) => array_keys($e->changes ?? []))->all())->toBe([
            ['name'], ['schedule'], ['name'], ['schedule'], ['schedule'],
        ]);
});

it('works out the next run of a schedule that ends after N runs from the runs it had', function () use ($world, $firstMonday) {
    [$web, $mara] = $world();
    $this->travelTo('2026-10-28 09:00:00');
    $template = SaveTemplate::run(actor($mara), $web, ['name' => 'A', 'payload' => ['title' => 'A'], 'schedule' => null]);
    $template->update(['run_count' => 3]);

    $saved = SaveTemplate::run(actor($mara), null, ['name' => 'A', 'payload' => ['title' => 'A'], 'schedule' => $firstMonday(['ends' => ['type' => 'count', 'count' => 3]])], $template);

    expect($saved->next_run_at)->toBeNull()
        ->and($saved->schedule_from?->utc()->format('Y-m-d H:i'))->toBe('2026-10-28 09:00');
});

it('writes no event for its own answer sent back with description_json alone', function () use ($world, $firstMonday, $task, $askFor) {
    [$web, $mara] = $world();
    $askFor($task(), Property::factory()->create(['key' => 'notes', 'label' => 'Notizen', 'field_type' => FieldType::RichText]));
    $askFor($task(), Property::factory()->create(['key' => 'budget', 'label' => 'Budget', 'field_type' => FieldType::Number, 'settings' => ['decimals' => 1]]));
    $askFor($task(), Property::factory()->dropdown(['S', 'M'], true)->create(['key' => 'size', 'label' => 'Größe']));
    $sizes = Property::query()->where('key', 'size')->firstOrFail()->options()->pluck('id')->all();
    [$ux, $bug] = [Label::factory()->create(['name' => 'UX']), Label::factory()->create(['name' => 'Bug'])];
    WorkItem::factory()->for($web)->create();
    $this->travelTo('2026-10-28 09:00:00');
    $template = SaveTemplate::run(actor($mara), $web, [
        'name' => 'Bericht',
        'payload' => [
            'title' => 'Bericht {week}', 'description' => "## Ablauf\n\nMit @mara und WEB-1, **fett** und _kursiv_", 'priority' => 'high',
            'assignee_id' => $mara->id, 'label_ids' => [$bug->id, $ux->id], 'start_offset_days' => 1, 'due_offset_days' => 3,
            'values' => ['size' => [$sizes[1], $sizes[0]], 'notes' => 'Notiz', 'budget' => 2],
        ],
        'schedule' => $firstMonday(),
    ]);
    $answer = (new TemplateResource($template->fresh()))->resolve(Request::create('/'));
    $answer = json_decode((string) json_encode($answer), true);
    unset($answer['payload']['description']);

    $this->travelTo('2026-10-29 09:00:00');
    $again = SaveTemplate::run(actor($mara), null, $answer, $template->fresh());

    expect(eventsOf(EventType::TemplateUpdated, $template))->toHaveCount(0)
        ->and($again->updated_at?->toJSON())->toBe($template->updated_at?->toJSON())
        ->and($again->schedule_from?->toJSON())->toBe($template->schedule_from?->toJSON())
        ->and($again->payload)->toBe($template->fresh()?->payload);
});

it('replaces the template as a whole and records what changed', function () use ($world) {
    [$web, $mara] = $world();
    $template = SaveTemplate::run(actor($mara), $web, ['name' => 'A', 'payload' => ['title' => 'A', 'priority' => 'high', 'description' => 'Text'], 'schedule' => null]);

    $saved = SaveTemplate::run(actor($mara), null, ['name' => 'A', 'payload' => ['title' => 'B'], 'schedule' => null], $template);
    $changes = eventsOf(EventType::TemplateUpdated, $template)->sole()->changes;

    expect($saved->payload)->toMatchArray(['title' => 'B', 'priority' => 'none', 'description' => null])
        ->and(array_keys($changes ?? []))->toBe(['payload'])
        ->and($changes['payload']['old']['title'] ?? null)->toBe('A')
        ->and($changes['payload']['new']['title'] ?? null)->toBe('B')
        ->and($saved->created_by)->toBe($mara->id);
});

it('lets an archived type the template already has stay, and no other', function () use ($world) {
    [$web, $mara] = $world();
    $bug = WorkItemType::query()->where('name', 'Bug')->firstOrFail();
    $template = SaveTemplate::run(actor($mara), $web, ['name' => 'A', 'payload' => ['type_id' => $bug->id, 'title' => 'A'], 'schedule' => null]);
    $bug->update(['archived_at' => now()]);
    $other = Template::factory()->create(['project_id' => $web->id]);

    expect(SaveTemplate::run(actor($mara), null, ['name' => 'B', 'payload' => ['type_id' => $bug->id, 'title' => 'A'], 'schedule' => null], $template)->name)->toBe('B')
        ->and(invalidOf(fn () => SaveTemplate::run(actor($mara), null, ['name' => 'B', 'payload' => ['type_id' => $bug->id, 'title' => 'A'], 'schedule' => null], $other)))
        ->toBe(['payload.type_id' => [__('field.type_id.archived')]]);
});

it('refuses an archived project with 409', function () use ($world) {
    [$web, $mara] = $world();
    $template = Template::factory()->create(['project_id' => $web->id]);
    $web->update(['archived_at' => now()]);

    $created = problemOf(fn () => SaveTemplate::run(actor($mara), $web, ['name' => 'A', 'payload' => ['title' => 'A'], 'schedule' => null]));
    $saved = problemOf(fn () => SaveTemplate::run(actor($mara), null, ['name' => 'A', 'payload' => ['title' => 'A'], 'schedule' => null], $template));

    expect([$created->status, $created->reason, $created->detail])->toBe([409, 'project_archived', __('problem.detail.project_archived')])
        ->and([$saved->status, $saved->reason])->toBe([409, 'project_archived'])
        ->and(Template::query()->count())->toBe(1);
});

it('refuses viewers with 403 and hides the templates of a private project', function () use ($world) {
    [$web, , $lene] = $world();
    $template = Template::factory()->create(['project_id' => $web->id]);
    $ops = Project::factory()->identifier('OPS')->private()->create();
    $hidden = Template::factory()->create(['project_id' => $ops->id]);
    $input = ['name' => 'A', 'payload' => ['title' => 'A'], 'schedule' => null];

    $denied = problemOf(fn () => SaveTemplate::run(actor($lene), $web, $input));

    expect([$denied->status, $denied->detail])->toBe([403, __('problem.detail.templates_members_only')])
        ->and(problemOf(fn () => SaveTemplate::run(actor($lene), null, $input, $template))->status)->toBe(403)
        ->and(problemOf(fn () => SaveTemplate::run(actor($lene), $ops, $input))->status)->toBe(404)
        ->and(problemOf(fn () => SaveTemplate::run(actor($lene), null, $input, $hidden))->status)->toBe(404);
});

it('answers 404 for a template deleted meanwhile', function () use ($world) {
    [$web, $mara] = $world();
    $template = Template::factory()->create(['project_id' => $web->id]);
    DB::table('templates')->where('id', $template->id)->delete();

    expect(problemOf(fn () => SaveTemplate::run(actor($mara), null, ['name' => 'A', 'payload' => ['title' => 'A'], 'schedule' => null], $template))->status)->toBe(404);
});

it('gives the template the uploads its texts name, and refuses one it may not use', function () use ($world, $task, $askFor) {
    [$web, $mara, $lene] = $world();
    Storage::fake('local');
    $askFor($task(), Property::factory()->create(['key' => 'notes', 'label' => 'Notizen', 'field_type' => FieldType::RichText]));
    $image = Attachment::factory()->create(['project_id' => $web->id, 'uploaded_by' => $mara->id, 'kind' => 'inline']);
    $file = Attachment::factory()->create(['project_id' => $web->id, 'uploaded_by' => $mara->id, 'kind' => 'inline']);
    $foreign = Attachment::factory()->create(['project_id' => $web->id, 'uploaded_by' => $lene->id, 'kind' => 'inline']);

    $template = SaveTemplate::run(actor($mara), $web, ['name' => 'A', 'payload' => [
        'title' => 'A', 'description' => "![Bild](attachment:{$image->id})", 'values' => ['notes' => "[datei.pdf](attachment:{$file->id})"],
    ], 'schedule' => null]);

    expect($image->fresh()?->only(['attachable_type', 'attachable_id']))->toBe(['attachable_type' => 'template', 'attachable_id' => $template->id])
        ->and($file->fresh()?->attachable_id)->toBe($template->id)
        ->and(invalidOf(fn () => SaveTemplate::run(actor($mara), $web, ['name' => 'B', 'payload' => ['title' => 'B', 'description_json' => [
            'type' => 'doc', 'content' => [['type' => 'image', 'attrs' => ['attachmentId' => $foreign->id, 'alt' => null]]],
        ]], 'schedule' => null])))->toBe(['payload.description_json' => [__('field.rich_text.attachment')]]);
});

it('reads Markdown before any lock', function () use ($world) {
    [$web, $mara] = $world();
    $queries = [];
    DB::listen(function ($query) use (&$queries) {
        $queries[] = $query->sql;
    });

    SaveTemplate::run(actor($mara), $web, ['name' => 'A', 'payload' => ['title' => 'A', 'description' => 'Mit @mara'], 'schedule' => null]);
    $handles = array_key_first(array_filter($queries, fn (string $sql) => str_contains($sql, 'from `users`') && str_contains($sql, '`handle` in')));
    $lock = array_key_first(array_filter($queries, fn (string $sql) => str_ends_with($sql, 'for update') || str_ends_with($sql, 'lock in share mode')));

    expect($handles)->not->toBeNull()
        ->and($lock)->toBeGreaterThan($handles)
        ->and($queries[$lock])->toStartWith('select * from `organization`');
});
