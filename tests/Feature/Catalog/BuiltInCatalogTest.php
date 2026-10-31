<?php

use App\Actions\Setup\EnsureCatalog;
use App\Domain\Catalog\Tone;
use App\Domain\Properties\FieldType;
use App\Domain\Workflow\StateCategory;
use App\Domain\Workflow\StateIcon;
use App\Events\EventType;
use App\Models\Event;
use App\Models\Organization;
use App\Models\Property;
use App\Models\RelationType;
use App\Models\Resolution;
use App\Models\TypeProperty;
use App\Models\User;
use App\Models\Workflow;
use App\Models\WorkItemType;

/** The catalog events of the migration: they are all there is in `events` for these subjects. */
$catalogEvents = fn () => Event::query()->whereIn('type', [
    EventType::WorkflowCreated, EventType::WorkItemTypeCreated, EventType::PropertyCreated,
    EventType::ResolutionCreated, EventType::RelationTypeCreated,
])->get();

it('ships the standard workflow as the default, free, with six states and Backlog to start', function () {
    $workflow = Workflow::default();

    expect(Workflow::query()->count())->toBe(1)
        ->and([$workflow->name, $workflow->description, $workflow->is_free])
        ->toBe(['Standard', 'The default workflow: every status can be reached from anywhere.', true])
        ->and($workflow->states->map(fn ($state) => [$state->name, $state->icon, $state->category])->all())->toBe([
            ['Backlog', StateIcon::Dashed, StateCategory::Backlog],
            ['Todo', StateIcon::Circle, StateCategory::Unstarted],
            ['In Progress', StateIcon::Half, StateCategory::Started],
            ['Pending', StateIcon::Pause, StateCategory::Started],
            ['Done', StateIcon::Check, StateCategory::Completed],
            ['Cancelled', StateIcon::Cross, StateCategory::Canceled],
        ])
        ->and($workflow->initial_state_id)->toBe($workflow->states[0]->id)
        ->and($workflow->graph()->issues())->toBe([]);
});

it('ships Task, Bug and Epic in this order, Bug with an optional effort and Epic as the epic type', function () {
    $types = WorkItemType::query()->orderBy('id')->get();
    $effort = Property::query()->sole();

    expect($types->map(fn ($type) => [$type->name, $type->icon, $type->tone, $type->is_epic, $type->description])->all())->toBe([
        ['Task', 'square-check', Tone::Sky, false, 'A task somebody gets done.'],
        ['Bug', 'bug', Tone::Ochre, false, 'A defect that needs fixing.'],
        ['Epic', 'zap', Tone::Moss, true, 'A larger undertaking that breaks down into items. Shows on the timeline.'],
    ])
        ->and([$effort->key, $effort->label, $effort->field_type, $effort->settings, $effort->default_value, $effort->help])
        ->toBe(['effort', 'Effort (h)', FieldType::Number, ['decimals' => 1], null, 'Estimated hours, to one decimal place.'])
        ->and(TypeProperty::query()->count())->toBe(1)
        ->and($types[1]->typeProperties->map(fn ($row) => [$row->property_id, $row->required, $row->position])->all())
        ->toBe([[$effort->id, false, 0]]);
});

it('ships the four resolutions with Done and Won\'t do as the defaults', function () {
    expect(Resolution::query()->orderBy('position')->get()->map(fn ($r) => [$r->label, $r->default_for, $r->position])->all())->toBe([
        ['Done', 'completed', 0],
        ["Won't do", 'canceled', 1],
        ['Duplicate', null, 2],
        ['Cannot reproduce', null, 3],
    ]);
});

it('ships blocks, duplicates and related as built-in relation types, related symmetric', function () {
    $types = RelationType::query()->get()->keyBy('built_in');

    expect($types->keys()->sort()->values()->all())->toBe(['blocks', 'duplicates', 'relates'])
        ->and([$types['blocks']->name, $types['blocks']->outward_label, $types['blocks']->inward_label])->toBe(['blocks', 'blocks', 'is blocked by'])
        ->and([$types['duplicates']->name, $types['duplicates']->outward_label, $types['duplicates']->inward_label])->toBe(['Duplicate', 'duplicates', 'is duplicated by'])
        ->and([$types['relates']->name, $types['relates']->outward_label, $types['relates']->inward_label])->toBe(['related', 'relates to', null]);
});

it('records what it created as the default bot, without webhooks', function () use ($catalogEvents) {
    $events = $catalogEvents();

    expect($events)->toHaveCount(1 + 3 + 1 + 4 + 3)
        ->and($events->every(fn (Event $event) => $event->actor_id === User::defaultBot()->id
            && $event->meta === ['via' => 'system', 'reason' => 'setup']
            && $event->project_id === null
            && ! $event->type->webhook()))->toBeTrue();

    $workflow = $events->firstWhere('type', EventType::WorkflowCreated);

    expect($workflow->subject_id)->toBe(Workflow::default()->id)
        ->and($workflow->changes)->toBe(['name' => ['old' => null, 'new' => 'Standard']])
        ->and($events->firstWhere('type', EventType::PropertyCreated)->changes)->toBe(['label' => ['old' => null, 'new' => 'Effort (h)']])
        ->and($events->where('type', EventType::ResolutionCreated)->pluck('subject_id')->sort()->values()->all())
        ->toBe(Resolution::query()->pluck('id')->sort()->values()->all());
});

it('creates nothing twice', function () use ($catalogEvents) {
    $before = [$catalogEvents()->count(), Workflow::query()->count(), WorkItemType::query()->count(), Property::query()->count(),
        Resolution::query()->count(), RelationType::query()->count(), Event::query()->count()];

    EnsureCatalog::run();

    expect([$catalogEvents()->count(), Workflow::query()->count(), WorkItemType::query()->count(), Property::query()->count(),
        Resolution::query()->count(), RelationType::query()->count(), Event::query()->count()])->toBe($before);
});

it('names the built-in entries in the language of the organization', function () {
    RelationType::query()->delete();
    WorkItemType::query()->delete();
    Property::query()->delete();
    Workflow::query()->delete(); // there are no projects in the test
    Organization::current()->update(['locale' => 'de']);

    EnsureCatalog::run();

    $relations = RelationType::query()->get()->keyBy('built_in')->map(fn ($r) => [$r->name, $r->outward_label, $r->inward_label]);

    expect($relations->all())->toBe([
        'blocks' => ['blockiert', 'blockiert', 'wird blockiert von'],
        'duplicates' => ['Duplikat', 'ist Duplikat von', 'hat Duplikat'],
        'relates' => ['verwandt', 'verwandt mit', null],
    ])
        ->and(Workflow::default()->description)->toBe('Der Standard-Workflow: Jeder Status ist von überall erreichbar.')
        ->and(WorkItemType::query()->orderBy('id')->pluck('description')->all())->toBe([
            'Eine Aufgabe, die jemand erledigt.',
            'Ein Fehler, der behoben werden muss.',
            'Ein größeres Vorhaben, das in Items zerfällt. Erscheint in der Timeline.',
        ])
        ->and(Property::query()->sole()->only(['label', 'help']))->toBe([
            'label' => 'Aufwand (h)',
            'help' => 'Geschätzte Stunden, auf eine Nachkommastelle.',
        ]);

    // the other language: the same code, other words
    RelationType::query()->delete();
    Workflow::query()->delete();
    Organization::current()->update(['locale' => 'en']);

    EnsureCatalog::run();

    expect(RelationType::query()->where('built_in', 'blocks')->sole()->name)->toBe('blocks')
        ->and(Workflow::default()->description)->toBe('The default workflow: every status can be reached from anywhere.');
});

it('adds a missing built-in relation type only', function () {
    $others = RelationType::query()->where('built_in', '!=', 'duplicates')->pluck('id', 'built_in')->all();
    RelationType::query()->where('built_in', 'duplicates')->delete();
    $events = Event::query()->count();

    EnsureCatalog::run();

    expect(RelationType::query()->count())->toBe(3)
        ->and(RelationType::query()->where('built_in', '!=', 'duplicates')->pluck('id', 'built_in')->all())->toBe($others)
        ->and(RelationType::query()->where('built_in', 'duplicates')->exists())->toBeTrue()
        ->and(Event::query()->count())->toBe($events + 1);
});

it('makes a custom relation type with the name of a missing built-in one the built-in one', function () {
    RelationType::query()->where('built_in', 'blocks')->delete();
    $custom = RelationType::query()->create(['name' => 'blocks', 'outward_label' => 'hält auf', 'inward_label' => 'wird aufgehalten von']);
    $events = Event::query()->count();

    EnsureCatalog::run();

    $event = eventsOf(EventType::RelationTypeUpdated, $custom)->sole();

    expect(RelationType::query()->count())->toBe(3)
        ->and(RelationType::query()->where('built_in', 'blocks')->sole()->id)->toBe($custom->id)
        ->and($custom->fresh()?->outward_label)->toBe('hält auf')
        ->and(Event::query()->count())->toBe($events + 1)
        ->and([$event->actor_id, $event->meta, $event->changes])
        ->toBe([User::defaultBot()->id, ['via' => 'system', 'reason' => 'setup'], ['built_in' => ['old' => null, 'new' => 'blocks']]]);
});

it('takes the effort property it finds instead of a second one', function () {
    $effort = Property::query()->sole();
    $effort->update(['label' => 'Stunden']);
    WorkItemType::query()->delete();
    $events = Event::query()->count();

    EnsureCatalog::run();

    $bug = WorkItemType::query()->where('name', 'Bug')->sole();

    expect(WorkItemType::query()->count())->toBe(3)
        ->and(Property::query()->count())->toBe(1)
        ->and($effort->fresh()?->label)->toBe('Stunden')
        ->and($bug->typeProperties->pluck('property_id')->all())->toBe([$effort->id])
        ->and(Event::query()->count())->toBe($events + 3)
        ->and(Event::query()->where('type', EventType::PropertyCreated)->count())->toBe(1);
});
