<?php

use App\Access\ProjectRole;
use App\Access\RoleAssignments;
use App\Access\Visibility;
use App\Actions\WorkItems\CreateWorkItem;
use App\Domain\Properties\FieldType;
use App\Domain\Workflow\StateCategory;
use App\Domain\WorkItems\Priority;
use App\Events\EventType;
use App\Models\Event;
use App\Models\Label;
use App\Models\Project;
use App\Models\Property;
use App\Models\Resolution;
use App\Models\User;
use App\Models\Workflow;
use App\Models\WorkItem;
use App\Models\WorkItemSubscriber;
use App\Models\WorkItemType;
use App\Support\ItemValues;
use Database\Seeders\Demo\CatalogSeeder;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use Tests\Support\RichTextFixtures;

/** WEB with Mara as its admin and lead. */
$web = function (): array {
    $mara = User::factory()->create(['name' => 'Mara']);
    $web = Project::factory()->identifier('WEB')->member($mara, ProjectRole::Admin)->create(['lead_id' => $mara->id]);

    return [$web, $mara];
};

/** A property the type asks for, at the end of its list. */
$askFor = function (WorkItemType $type, Property $property, bool $required = false): Property {
    $type->typeProperties()->create(['property_id' => $property->id, 'required' => $required, 'position' => $type->typeProperties()->count()]);

    return $property;
};

$task = fn (): WorkItemType => WorkItemType::query()->where('name', 'Task')->firstOrFail();

it('numbers the items of a project and never reuses a number', function () use ($web) {
    [$project, $mara] = $web();
    $create = fn () => CreateWorkItem::run(actor($mara), ['project_id' => $project->id, 'title' => 'Item']);

    $numbers = [$create()->number, $create()->number];
    $third = $create();
    DB::table('work_items')->where('id', $third->id)->delete();

    expect([...$numbers, $third->number])->toBe([1, 2, 3])
        ->and($create()->number)->toBe(4)
        ->and($project->fresh()?->next_number)->toBe(4);
});

it('counts per project', function () use ($web) {
    [$web, $mara] = $web();
    $ops = Project::factory()->identifier('OPS')->member($mara, ProjectRole::Member)->create();

    expect(CreateWorkItem::run(actor($mara), ['project_id' => 'WEB', 'title' => 'Web'])->key)->toBe('WEB-1')
        ->and(CreateWorkItem::run(actor($mara), ['project_id' => 'OPS', 'title' => 'Ops'])->key)->toBe('OPS-1');
});

it('leaves the updated_at of the project alone', function () use ($web) {
    [$project, $mara] = $web();
    $project->forceFill(['updated_at' => now()->subDay()])->save();
    $before = $project->fresh()?->updated_at?->toJSON();

    CreateWorkItem::run(actor($mara), ['project_id' => $project->id, 'title' => 'Item']);

    expect($project->fresh()?->updated_at?->toJSON())->toBe($before);
});

it('puts a new item after the last one', function () use ($web) {
    [$project, $mara] = $web();
    // a rank of the factory with upper and lower case: only a byte order puts the new one after it
    WorkItem::factory()->for($project)->create(['rank' => 'Zz']);
    $first = CreateWorkItem::run(actor($mara), ['project_id' => $project->id, 'title' => 'Eins']);
    $second = CreateWorkItem::run(actor($mara), ['project_id' => $project->id, 'title' => 'Zwei']);

    expect(strcmp($first->rank, 'Zz'))->toBeGreaterThan(0)
        ->and(strcmp($second->rank, $first->rank))->toBeGreaterThan(0);
});

it('starts in the initial state of the workflow, without stamps or resolution in an open one', function () use ($web) {
    [$project, $mara] = $web();

    $item = CreateWorkItem::run(actor($mara), ['project_id' => $project->id, 'title' => 'Item']);

    expect($item->state_id)->toBe(Workflow::default()->initial_state_id)
        ->and($item->started_at)->toBeNull()
        ->and($item->closed_at)->toBeNull()
        ->and($item->resolution_id)->toBeNull()
        ->and($item->description_version)->toBe(1)
        ->and($item->created_by)->toBe($mara->id);
});

it('stamps an item whose workflow starts in a started or a completed state', function () use ($web) {
    [$project, $mara] = $web();
    $workflow = Workflow::factory()->create();
    $project->update(['workflow_id' => $workflow->id]);
    $start = fn (string $name) => $workflow->update(['initial_state_id' => $workflow->states()->where('name', $name)->value('id')]);

    $start('Doing');
    $started = CreateWorkItem::run(actor($mara), ['project_id' => $project->id, 'title' => 'Läuft']);
    $start('Done');
    $done = CreateWorkItem::run(actor($mara), ['project_id' => $project->id, 'title' => 'Fertig']);

    expect($started->started_at)->not->toBeNull()
        ->and($started->closed_at)->toBeNull()
        ->and($started->resolution_id)->toBeNull()
        ->and($done->started_at)->toBeNull()
        ->and($done->closed_at)->not->toBeNull()
        ->and($done->resolution_id)->toBe(Resolution::query()->where('default_for', StateCategory::Completed->value)->value('id'));
});

it('takes the default type of the project', function () use ($web) {
    [$project, $mara] = $web();
    $bug = WorkItemType::query()->where('name', 'Bug')->firstOrFail();
    $project->update(['default_type_id' => $bug->id]);

    expect(CreateWorkItem::run(actor($mara), ['project_id' => $project->id, 'title' => 'Item'])->type_id)->toBe($bug->id)
        ->and(CreateWorkItem::run(actor($mara), ['project_id' => $project->id, 'title' => 'Item', 'type_id' => null])->type_id)->toBe($bug->id);
});

it('takes a type switched on in the project, also by an upper-case ULID', function () use ($web, $task) {
    [$project, $mara] = $web();

    $item = CreateWorkItem::run(actor($mara), ['project_id' => $project->id, 'title' => 'Item', 'type_id' => strtoupper($task()->id)]);

    expect($item->type_id)->toBe($task()->id);
});

it('refuses a type the project has not switched on or that is archived', function () use ($web, $task) {
    [$project, $mara] = $web();
    $off = WorkItemType::factory()->create();
    $archived = WorkItemType::factory()->create();
    $project->types()->attach($archived->id);
    $archived->update(['archived_at' => now()]);
    $create = fn (mixed $type) => invalidOf(fn () => CreateWorkItem::run(actor($mara), ['project_id' => $project->id, 'title' => 'Item', 'type_id' => $type]));

    expect($create($off->id))->toBe(['type_id' => [__('field.type_id.disabled')]])
        ->and($create((string) Str::ulid()))->toBe(['type_id' => [__('field.type_id.disabled')]])
        ->and($create('Task'))->toBe(['type_id' => [__('field.type_id.disabled')]])
        ->and($create(['id' => $task()->id]))->toBe(['type_id' => [__('field.type_id.disabled')]])
        ->and($create($archived->id))->toBe(['type_id' => [__('field.type_id.archived')]]);
});

it('trims the title and refuses an empty or too long one', function () use ($web) {
    [$project, $mara] = $web();
    $create = fn (mixed $title) => CreateWorkItem::run(actor($mara), ['project_id' => $project->id, 'title' => $title]);

    expect($create('  Formular prüfen  ')->title)->toBe('Formular prüfen')
        ->and($create(str_repeat('ä', 255))->title)->toBe(str_repeat('ä', 255))
        ->and(invalidOf(fn () => $create('   ')))->toBe(['title' => [__('field.title.required')]])
        ->and(invalidOf(fn () => $create(null)))->toBe(['title' => [__('field.title.required')]])
        ->and(invalidOf(fn () => $create(['Titel'])))->toBe(['title' => [__('field.title.required')]])
        ->and(invalidOf(fn () => $create(str_repeat('ä', 256))))->toBe(['title' => [__('field.title.max', ['max' => 255])]])
        ->and(__('field.title.max', ['max' => 255], 'de'))->toBe('Der Titel darf höchstens 255 Zeichen haben.');
});

it('sets no priority by default and refuses an unknown one', function () use ($web) {
    [$project, $mara] = $web();
    $create = fn (array $input) => CreateWorkItem::run(actor($mara), ['project_id' => $project->id, 'title' => 'Item', ...$input]);

    expect($create([])->priority)->toBe(Priority::None)
        ->and($create(['priority' => 'urgent'])->priority)->toBe(Priority::Urgent)
        ->and(invalidOf(fn () => $create(['priority' => 'Urgent'])))->toBe(['priority' => [__('field.priority.invalid')]])
        ->and(invalidOf(fn () => $create(['priority' => 1])))->toBe(['priority' => [__('field.priority.invalid')]]);
});

it('drops duplicate labels and refuses unknown ones', function () use ($web) {
    [$project, $mara] = $web();
    $ux = Label::factory()->create();
    $backend = Label::factory()->create();
    $create = fn (mixed $labels) => CreateWorkItem::run(actor($mara), ['project_id' => $project->id, 'title' => 'Item', 'label_ids' => $labels]);

    $item = $create([$backend->id, strtoupper($ux->id), $ux->id]);

    expect($item->labels()->pluck('labels.id')->all())->toBe(collect([$ux->id, $backend->id])->sort()->values()->all())
        ->and($create(null)->labels()->count())->toBe(0);

    foreach ([[(string) Str::ulid()], [$ux->id, 'UX'], 'UX', [[$ux->id]], ['a' => $ux->id]] as $labels) {
        expect(invalidOf(fn () => $create($labels)))->toBe(['label_ids' => [__('field.label_ids.unknown')]]);
    }
});

it('refuses a start after the due date, at the due date', function () use ($web) {
    [$project, $mara] = $web();
    $create = fn (?string $start, ?string $due) => CreateWorkItem::run(actor($mara), ['project_id' => $project->id, 'title' => 'Item', 'start_date' => $start, 'due_date' => $due]);

    $same = $create('2026-10-31', '2026-10-31');

    expect($same->start_date?->format('Y-m-d'))->toBe('2026-10-31')
        ->and($same->due_date?->format('Y-m-d'))->toBe('2026-10-31')
        ->and($create('2026-11-01', null)->due_date)->toBeNull()
        ->and(invalidOf(fn () => $create('2026-11-01', '2026-10-31')))->toBe(['due_date' => [__('field.due_date.before_start')]]);
});

it('refuses an impossible day', function () use ($web) {
    [$project, $mara] = $web();
    $create = fn (array $dates) => invalidOf(fn () => CreateWorkItem::run(actor($mara), ['project_id' => $project->id, 'title' => 'Item', ...$dates]));

    expect($create(['start_date' => '2026-02-30', 'due_date' => "2026-10-31\n"]))->toBe([
        'start_date' => [__('field.date.invalid')],
        'due_date' => [__('field.date.invalid')],
    ])
        ->and($create(['due_date' => '31.10.2026']))->toBe(['due_date' => [__('field.date.invalid')]])
        ->and($create(['start_date' => 20261031]))->toBe(['start_date' => [__('field.date.invalid')]]);
});

it('lets members and org admins take the item, but no other bot and no deactivated member', function () use ($web) {
    [$project, $mara] = $web();
    $member = memberOf($project, ProjectRole::Member);
    $viewer = memberOf($project, ProjectRole::Viewer);
    $admin = User::factory()->admin()->create();
    $botMember = User::factory()->bot()->create();
    $disabled = memberOf($project, ProjectRole::Member);
    $disabled->forceFill(['disabled_at' => now()])->save();
    app(RoleAssignments::class)->setProjectRole($botMember, $project, ProjectRole::Member);
    $outsider = User::factory()->create();
    $bot = User::factory()->bot()->create();
    $create = fn (mixed $assignee) => CreateWorkItem::run(actor($mara), ['project_id' => $project->id, 'title' => 'Item', 'assignee_id' => $assignee]);

    foreach ([$member, $viewer, $admin, $botMember] as $user) {
        expect($create(strtoupper($user->id))->assignee_id)->toBe($user->id);
    }
    foreach ([$disabled->id, $outsider->id, $bot->id, User::defaultBot()->id, (string) Str::ulid(), 'mara', 7] as $id) {
        expect(invalidOf(fn () => $create($id)))->toBe(['assignee_id' => [__('field.assignee_id.invalid')]]);
    }
});

it('refuses a parent of another project, and one of a project the actor does not see as unknown', function () use ($web) {
    [$project, $mara] = $web();
    $epic = fn (Project $in) => WorkItem::factory()->for($in)->epic()->create();
    $public = $epic(Project::factory()->identifier('APP')->create());
    $private = $epic(Project::factory()->identifier('OPS')->private()->create());
    $create = fn (mixed $parent) => invalidOf(fn () => CreateWorkItem::run(actor($mara), ['project_id' => $project->id, 'title' => 'Item', 'parent_id' => $parent]));

    expect($create($public->id))->toBe(['parent_id' => [__('field.parent_id.project')]])
        ->and($create('APP-1'))->toBe(['parent_id' => [__('field.parent_id.project')]])
        ->and($create($private->id))->toBe(['parent_id' => [__('field.parent_id.unknown')]])
        ->and($create('OPS-1'))->toBe(['parent_id' => [__('field.parent_id.unknown')]])
        ->and($create('WEB-99'))->toBe(['parent_id' => [__('field.parent_id.unknown')]])
        ->and($create(['WEB-1']))->toBe(['parent_id' => [__('field.parent_id.unknown')]]);
});

it('refuses a parent that is no epic and an epic with a parent, with their reasons', function () use ($web) {
    [$project, $mara] = $web();
    $epic = WorkItem::factory()->for($project)->epic()->create();
    $task = WorkItem::factory()->for($project)->create();
    $create = fn (array $input) => CreateWorkItem::run(actor($mara), ['project_id' => $project->id, 'title' => 'Item', ...$input]);

    $noEpic = problemOf(fn () => $create(['parent_id' => $task->id]));
    $epicChild = problemOf(fn () => $create(['parent_id' => $epic->id, 'type_id' => $epic->type_id]));

    expect([$noEpic->status, $noEpic->reason, $noEpic->errors])->toBe([422, 'parent_not_epic', ['parent_id' => [__('problem.reason.parent_not_epic')]]])
        ->and([$epicChild->status, $epicChild->reason, $epicChild->errors])->toBe([422, 'epic_has_no_parent', ['parent_id' => [__('problem.reason.epic_has_no_parent')]]])
        ->and($create(['parent_id' => $epic->id])->parent_id)->toBe($epic->id)
        ->and($project->fresh()?->next_number)->toBe(3);
});

it('finds the parent by key, in capitals as well', function () use ($web) {
    [$project, $mara] = $web();
    $epic = WorkItem::factory()->for($project)->epic()->create();

    $child = CreateWorkItem::run(actor($mara), ['project_id' => $project->id, 'title' => 'Kind', 'parent_id' => 'web-1']);
    $other = CreateWorkItem::run(actor($mara), ['project_id' => $project->id, 'title' => 'Kind', 'parent_id' => strtoupper($epic->id)]);

    expect($child->parent_id)->toBe($epic->id)
        ->and($other->parent_id)->toBe($epic->id);
});

it('requires the required properties and names each at its key', function () use ($web, $askFor, $task) {
    [$project, $mara] = $web();
    $askFor($task(), Property::factory()->create(['key' => 'customer', 'label' => 'Kunde']), true);
    $askFor($task(), Property::factory()->create(['key' => 'budget', 'label' => 'Budget', 'field_type' => FieldType::Number]), true);

    $errors = invalidOf(fn () => CreateWorkItem::run(actor($mara), ['project_id' => $project->id, 'title' => '', 'values' => ['customer' => '  ']]));

    expect($errors)->toBe([
        'title' => [__('field.title.required')],
        'values.customer' => [__('field.values.required', ['label' => 'Kunde'])],
        'values.budget' => [__('field.values.required', ['label' => 'Budget'])],
    ])
        ->and(__('field.values.required', ['label' => 'Kunde'], 'de'))->toBe('„Kunde“ ist ein Pflichtfeld.');

    $item = CreateWorkItem::run(actor($mara), ['project_id' => $project->id, 'title' => 'Item', 'values' => ['customer' => ' Feldwerk ', 'budget' => '12,5']]);

    expect(ItemValues::of($item->load('values.property')))->toBe(['customer' => 'Feldwerk', 'budget' => 13]);
});

it('uses the default value of a property when none is sent', function () use ($web, $askFor, $task) {
    [$project, $mara] = $web();
    $askFor($task(), Property::factory()->create(['key' => 'channel', 'default_value' => 'Web']), true);
    $size = $askFor($task(), Property::factory()->dropdown(['S', 'M'])->create(['key' => 'size']));
    [$small, $medium] = $size->options()->pluck('id')->all();
    $size->update(['default_value' => $medium]);
    $values = fn (array $input) => ItemValues::of(CreateWorkItem::run(actor($mara), ['project_id' => $project->id, 'title' => 'Item', ...$input])->load('values.property'));

    expect($values([]))->toBe(['channel' => 'Web', 'size' => $medium])
        ->and($values(['values' => ['size' => $small]]))->toBe(['channel' => 'Web', 'size' => $small])
        ->and($values(['values' => ['size' => null]]))->toBe(['channel' => 'Web']);

    // an option archived since it became the default is offered no more
    $size->options()->whereKey($medium)->update(['archived_at' => now()]);
    expect($values([]))->toBe(['channel' => 'Web']);

    // a required property whose default is sent away empty stays required
    expect(invalidOf(fn () => $values(['values' => ['channel' => '']])))->toBe(['values.channel' => [__('field.values.required', ['label' => Property::query()->where('key', 'channel')->value('label')])]]);
});

it('refuses a property of another type and values that are no map', function () use ($web, $askFor) {
    [$project, $mara] = $web();
    $bug = WorkItemType::query()->where('name', 'Bug')->firstOrFail();
    $askFor($bug, Property::factory()->create(['key' => 'browser']));
    $create = fn (mixed $values) => invalidOf(fn () => CreateWorkItem::run(actor($mara), ['project_id' => $project->id, 'title' => 'Item', 'values' => $values]));

    expect($create(['browser' => 'Safari']))->toBe(['values.browser' => [__('field.values.unknown', ['key' => 'browser', 'type' => 'Task'])]])
        ->and($create(['Safari']))->toBe(['values' => [__('field.values.invalid')]])
        ->and($create('browser=Safari'))->toBe(['values' => [__('field.values.invalid')]]);
});

it('takes Markdown or JSON for the description', function () use ($web) {
    [$project, $mara] = $web();
    $create = fn (array $input) => CreateWorkItem::run(actor($mara), ['project_id' => $project->id, 'title' => 'Item', ...$input]);

    $markdown = $create(['description' => "## Plan\n\nErst **lesen**, dann schreiben."]);
    $json = $create(['description_json' => RichTextFixtures::web47Steps()]);

    expect($markdown->description)->toBe(RichTextFixtures::doc(
        ['type' => 'heading', 'attrs' => ['level' => 2], 'content' => [RichTextFixtures::text('Plan')]],
        RichTextFixtures::p(RichTextFixtures::text('Erst '), RichTextFixtures::text('lesen', 'bold'), RichTextFixtures::text(', dann schreiben.')),
    ))
        ->and($markdown->description_text)->toBe("Plan\nErst lesen, dann schreiben.")
        ->and($json->description)->toBe(RichTextFixtures::web47Steps())
        ->and($json->description_text)->toStartWith('So lässt sich der Fehler nachstellen:')
        ->and($create(['description' => ''])->description)->toBeNull()
        ->and($create([])->description_text)->toBeNull();
});

it('reports rich text it cannot read together with the other field errors', function () use ($web, $askFor, $task) {
    [$project, $mara] = $web();
    $askFor($task(), Property::factory()->create(['key' => 'notes', 'label' => 'Notizen', 'field_type' => FieldType::RichText]), true);
    $create = fn (array $input) => invalidOf(fn () => CreateWorkItem::run(actor($mara), ['project_id' => $project->id, 'title' => '', ...$input]));

    expect($create(['description_json' => ['type' => 'doc', 'content' => [['type' => 'iframe']]], 'values' => ['notes' => ['type' => 'iframe']]]))->toBe([
        'description_json' => [__('field.rich_text.invalid')],
        'values.notes' => [__('field.values.rich_text', ['label' => 'Notizen'])],
        'title' => [__('field.title.required')],
    ])
        ->and($create(['description' => 'Text', 'description_json' => RichTextFixtures::web47Steps()]))->toBe([
            'description' => [__('field.rich_text.both')],
            'title' => [__('field.title.required')],
            'values.notes' => [__('field.values.required', ['label' => 'Notizen'])],
        ]);
});

it('wants a project', function () use ($web) {
    [, $mara] = $web();

    expect(invalidOf(fn () => CreateWorkItem::run(actor($mara), ['title' => 'Item'])))->toBe(['project_id' => [__('field.required')]])
        ->and(problemOf(fn () => CreateWorkItem::run(actor($mara), ['project_id' => 'NOPE', 'title' => 'Item']))->status)->toBe(404);
});

it('answers 404 for a project the actor does not see, also by identifier', function () {
    $ops = Project::factory()->identifier('OPS')->private()->create();
    $outsider = User::factory()->create();

    foreach ([$ops->id, 'OPS', 'ops'] as $reference) {
        $problem = problemOf(fn () => CreateWorkItem::run(actor($outsider), ['project_id' => $reference, 'title' => 'Item']));
        expect([$problem->status, $problem->detail])->toBe([404, null]);
    }
    expect(WorkItem::query()->count())->toBe(0);
});

it('refuses viewers with the sentence of the rule', function () use ($web) {
    [$project] = $web();
    $viewer = memberOf($project, ProjectRole::Viewer);
    $outsider = User::factory()->create();

    foreach ([$viewer, $outsider] as $user) {
        $problem = problemOf(fn () => CreateWorkItem::run(actor($user), ['project_id' => $project->id, 'title' => 'Item']));
        expect([$problem->status, $problem->detail])->toBe([403, __('problem.detail.items_members_only')]);
    }
});

it('answers 409 in an archived project', function () use ($web) {
    [$project, $mara] = $web();
    $project->update(['archived_at' => now()]);

    $problem = problemOf(fn () => CreateWorkItem::run(actor($mara), ['project_id' => $project->id, 'title' => '']));

    expect([$problem->status, $problem->reason, $problem->detail])->toBe([409, 'project_archived', __('problem.detail.project_archived')])
        ->and(__('problem.detail.project_archived', [], 'de'))->toBe('Das Projekt ist archiviert und schreibgeschützt.');
});

it('answers 404 for a project that is being deleted', function () use ($web) {
    [$project, $mara] = $web();
    $project->update(['deleting_at' => now()]);
    Visibility::forget();

    expect(problemOf(fn () => CreateWorkItem::run(actor($mara), ['project_id' => $project->id, 'title' => 'Item']))->status)->toBe(404);
});

it('makes the creator and the assignee watch, but no bot', function () use ($web) {
    [$project, $mara] = $web();
    $lene = memberOf($project, ProjectRole::Member);
    $bot = User::factory()->bot()->create();
    app(RoleAssignments::class)->setProjectRole($bot, $project, ProjectRole::Member);
    $watchers = fn (WorkItem $item) => WorkItemSubscriber::query()->where('work_item_id', $item->id)->orderBy('reason')->get()
        ->map(fn (WorkItemSubscriber $row) => [$row->user_id, $row->reason, $row->unsubscribed_at])->all();
    $create = fn (User $actor, ?User $assignee) => CreateWorkItem::run(actor($actor), ['project_id' => $project->id, 'title' => 'Item', 'assignee_id' => $assignee?->id]);

    expect($watchers($create($mara, $lene)))->toBe([[$lene->id, 'assigned', null], [$mara->id, 'created', null]])
        ->and($watchers($create($mara, $mara)))->toBe([[$mara->id, 'created', null]])
        ->and($watchers($create($mara, $bot)))->toBe([[$mara->id, 'created', null]])
        ->and($watchers($create(User::defaultBot(), $lene)))->toBe([[$lene->id, 'assigned', null]])
        ->and($watchers($create(User::defaultBot(), null)))->toBe([]);
});

it('records the creation with its title', function () use ($web) {
    [$project, $mara] = $web();

    $item = CreateWorkItem::run(actor($mara), ['project_id' => $project->id, 'title' => '  Formular  ']);
    $event = eventsOf(EventType::WorkItemCreated, $item)->sole();

    expect($event->changes)->toBe(['title' => ['old' => null, 'new' => 'Formular']])
        ->and($event->project_id)->toBe($project->id)
        ->and($event->actor_id)->toBe($mara->id);
});

it('rolls back everything when a value is refused', function () use ($web, $askFor, $task) {
    [$project, $mara] = $web();
    $askFor($task(), Property::factory()->create(['key' => 'budget', 'label' => 'Budget', 'field_type' => FieldType::Number]), true);
    $label = Label::factory()->create();

    $errors = invalidOf(fn () => CreateWorkItem::run(actor($mara), ['project_id' => $project->id, 'title' => 'Item', 'label_ids' => [$label->id], 'values' => ['budget' => 'viel']]));

    expect($errors)->toBe(['values.budget' => [__('field.values.number', ['label' => 'Budget'])]])
        ->and(WorkItem::query()->count())->toBe(0)
        ->and(DB::table('work_item_labels')->count())->toBe(0)
        ->and(WorkItemSubscriber::query()->count())->toBe(0)
        ->and($project->fresh()?->next_number)->toBe(0)
        ->and(eventsOf(EventType::WorkItemCreated))->toBeEmpty();
});

it('refuses a number the column cannot hold at its field, also as the default of a property', function () use ($web, $askFor, $task) {
    [$project, $mara] = $web();
    $budget = $askFor($task(), Property::factory()->create(['key' => 'budget', 'label' => 'Budget', 'field_type' => FieldType::Number]));
    $create = fn (array $values) => CreateWorkItem::run(actor($mara), ['project_id' => $project->id, 'title' => 'Item', 'values' => $values]);

    expect(invalidOf(fn () => $create(['budget' => 1e21])))->toBe(['values.budget' => [__('field.values.number_range', ['label' => 'Budget'])]])
        ->and(WorkItem::query()->count())->toBe(0);

    // a default stored before the rule (as JSON it holds any number) is not taken, as an archived option is not: no 500
    $budget->forceFill(['default_value' => 1e21])->save();
    expect($create([])->values)->toHaveCount(0);
});

it('stores the values with the item', function () use ($web, $askFor, $task) {
    [$project, $mara] = $web();
    $tags = $askFor($task(), Property::factory()->dropdown(['A', 'B', 'C'], multiple: true)->create(['key' => 'tags']));
    $askFor($task(), Property::factory()->create(['key' => 'ref']));
    $ids = $tags->options()->pluck('id')->all();
    $text = strtoupper((string) Str::ulid());

    $item = CreateWorkItem::run(actor($mara), ['project_id' => $project->id, 'title' => 'Item', 'values' => ['tags' => array_map(strtoupper(...), [$ids[2], $ids[0]]), 'ref' => $text]]);

    expect(ItemValues::of($item->load('values.property')))->toBe(['tags' => [$ids[2], $ids[0]], 'ref' => $text]);
});

it('creates in another state when the start state may move there', function () use ($web) {
    [$project, $mara] = $web();
    $done = Workflow::default()->states()->where('name', 'Done')->firstOrFail();

    $item = CreateWorkItem::run(actor($mara), ['project_id' => $project->id, 'title' => 'Schon erledigt', 'state_id' => strtoupper($done->id)]);
    $history = Event::query()->where('subject_id', $item->id)->orderBy('occurred_at')->orderBy('id')->get();

    expect($item->state_id)->toBe($done->id)
        ->and($item->fresh()?->state_id)->toBe($done->id)
        ->and($item->resolution_id)->toBe(Resolution::query()->where('default_for', StateCategory::Completed->value)->value('id'))
        ->and($item->closed_at)->not->toBeNull()
        ->and($item->started_at)->toBeNull()
        // the history shows the creation in the initial state, then the move
        ->and($history->pluck('type')->all())->toBe([EventType::WorkItemCreated, EventType::WorkItemStateChanged])
        ->and($history[1]->changes['state_id'])->toBe(['old' => Workflow::default()->initial_state_id, 'new' => $done->id])
        ->and($history[1]->meta['states']['new'])->toBe(['id' => $done->id, 'name' => 'Done', 'category' => 'completed'])
        ->and($history[0]->meta)->not->toHaveKey('states');
});

it('creates in the initial state named as such without a move', function () use ($web) {
    [$project, $mara] = $web();

    $item = CreateWorkItem::run(actor($mara), ['project_id' => $project->id, 'title' => 'Item', 'state_id' => Workflow::default()->initial_state_id]);

    expect($item->state_id)->toBe(Workflow::default()->initial_state_id)
        ->and(eventsOf(EventType::WorkItemStateChanged))->toBeEmpty();
});

it('refuses to create in a state the start state may not reach', function () use ($web) {
    [$project, $mara] = $web();
    $this->seed(CatalogSeeder::class);
    $agency = Workflow::query()->where('name', 'Agentur-Freigabe')->firstOrFail();
    $project->update(['workflow_id' => $agency->id]);
    $create = fn (mixed $state) => CreateWorkItem::run(actor($mara), ['project_id' => $project->id, 'title' => 'Item', 'state_id' => $state]);

    $refused = problemOf(fn () => $create($agency->states()->where('name', 'Done')->value('id')));
    $unknown = invalidOf(fn () => $create(Workflow::default()->initial_state_id));

    expect([$refused->status, $refused->reason])->toBe([409, 'transition_not_allowed'])
        ->and($refused->detail)->toBe(__('problem.detail.transition_from_start', ['initial' => 'Backlog', 'target' => 'Done', 'workflow' => 'Agentur-Freigabe']))
        ->and($unknown)->toBe(['state_id' => [__('field.state_id.unknown')]])
        ->and(invalidOf(fn () => $create(['x'])))->toBe(['state_id' => [__('field.state_id.unknown')]])
        ->and(WorkItem::query()->count())->toBe(0)
        ->and($project->fresh()?->next_number)->toBe(0)
        ->and(Event::query()->where('type', 'like', 'work_item.%')->count())->toBe(0)
        ->and($create($agency->states()->where('name', 'Todo')->value('id'))->number)->toBe(1);
});

it('reads the parent under a shared lock, after the project', function () use ($web) {
    [$project, $mara] = $web();
    WorkItem::factory()->for($project)->epic()->create();
    $queries = [];
    DB::listen(function ($query) use (&$queries) {
        $queries[] = $query->sql;
    });

    CreateWorkItem::run(actor($mara), ['project_id' => $project->id, 'title' => 'Kind', 'parent_id' => 'WEB-1']);
    $project = array_key_first(array_filter($queries, fn (string $sql) => str_starts_with($sql, 'select * from `projects`') && str_ends_with($sql, 'for update')));
    $parent = array_key_first(array_filter($queries, fn (string $sql) => str_starts_with($sql, 'select * from `work_items`') && str_ends_with($sql, 'lock in share mode')));

    expect($parent)->not->toBeNull()
        ->and($parent)->toBeGreaterThan($project)
        ->and($queries[$parent])->toContain('`id` = ?');
});
