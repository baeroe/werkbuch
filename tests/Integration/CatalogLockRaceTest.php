<?php

use App\Actions\Labels\DeleteLabel;
use App\Actions\Labels\SaveLabel;
use App\Actions\Projects\AssignWorkflow;
use App\Actions\Projects\UpdateProject;
use App\Actions\Properties\DeleteProperty;
use App\Actions\Properties\SaveProperty;
use App\Actions\RelationTypes\DeleteRelationType;
use App\Actions\RelationTypes\SaveRelationType;
use App\Actions\Resolutions\DeleteResolution;
use App\Actions\Resolutions\SaveResolution;
use App\Actions\Workflows\DeleteWorkflow;
use App\Actions\Workflows\SaveWorkflow;
use App\Actions\WorkItemTypes\DeleteWorkItemType;
use App\Actions\WorkItemTypes\SaveWorkItemType;
use App\Events\EventType;
use App\Exceptions\Problem;
use App\Models\Label;
use App\Models\Project;
use App\Models\Property;
use App\Models\RelationType;
use App\Models\Resolution;
use App\Models\User;
use App\Models\Workflow;
use App\Models\WorkItemType;
use App\Support\CatalogLock;
use Illuminate\Validation\ValidationException;
use Tests\Support\RaceConnections;
use Tests\Support\WorkflowFixtures;

/*
 * Every change of a catalog takes the lock of the organization first (CatalogLock) and checks its rules under it: one
 * default workflow, the order of states, a workflow in use, unique names. Two connections as in the other race tests:
 * `mariadb` holds its transaction open like a request in progress, `mariadb_second` is the other request and gives up
 * waiting for a lock after one second. Without the lock the second change would read what it saw before and wait, if at
 * all, for a row it writes, not for the organization.
 */

beforeEach(fn () => RaceConnections::setUp());

afterEach(fn () => RaceConnections::tearDown());

/** A work item type without properties. */
$typeInput = fn (string $name, array $overrides = []): array => ['name' => $name, 'icon' => 'flag', 'tone' => 'moss', 'is_epic' => false, 'properties' => [], ...$overrides];

/** A label. */
$labelInput = fn (string $name): array => ['name' => $name, 'color' => 'moss'];

/** A relation type with a label for each direction. */
$relationTypeInput = fn (string $name): array => ['name' => $name, 'outward_label' => 'testet', 'inward_label' => 'wird getestet von'];

/** A text property. */
$propertyInput = fn (string $key, string $label = 'Kunde'): array => ['key' => $key, 'label' => $label, 'field_type' => 'text'];

it('makes every change of the catalog wait for the lock of the organization', function (Closure $change) {
    $admin = User::factory()->admin()->create();
    $workflow = Workflow::factory()->create(['name' => 'Alt']);
    $type = WorkItemType::factory()->create(['name' => 'Alt']);
    $property = Property::factory()->create(['key' => 'alt']);
    $label = Label::factory()->create(['name' => 'Alt']);
    $relationType = RelationType::factory()->create(['name' => 'Alt']);
    $resolution = Resolution::factory()->create(['label' => 'Alt']);
    $project = Project::factory()->identifier('WEB')->create();

    // connection 1: another change of the catalog is in progress
    RaceConnections::hold(fn () => CatalogLock::take());

    // connection 2: this change waits for it instead of checking against what it read before
    RaceConnections::expectLockWait(RaceConnections::second(fn () => $change($admin, $workflow, $type, $property, $label, $relationType, $resolution, $project)), 'organization');
})->with([
    'create a workflow' => [fn (User $admin, Workflow $workflow) => SaveWorkflow::run(actor($admin), null, WorkflowFixtures::agencyInput())],
    'change a workflow' => [fn (User $admin, Workflow $workflow) => SaveWorkflow::run(actor($admin), $workflow, [...WorkflowFixtures::inputOf($workflow), 'name' => 'Neu'])],
    'delete a workflow' => [fn (User $admin, Workflow $workflow) => DeleteWorkflow::run(actor($admin), $workflow)],
    'create a type' => [fn (User $admin) => SaveWorkItemType::run(actor($admin), null, $typeInput('Neu'))],
    'change a type' => [fn (User $admin, Workflow $workflow, WorkItemType $type) => SaveWorkItemType::run(actor($admin), $type, $typeInput('Neu'))],
    'delete a type' => [fn (User $admin, Workflow $workflow, WorkItemType $type) => DeleteWorkItemType::run(actor($admin), $type)],
    'create a property' => [fn (User $admin) => SaveProperty::run(actor($admin), null, $propertyInput('neu'))],
    'change a property' => [fn (User $admin, Workflow $workflow, WorkItemType $type, Property $property) => SaveProperty::run(actor($admin), $property, $propertyInput('alt', 'Neu'))],
    'delete a property' => [fn (User $admin, Workflow $workflow, WorkItemType $type, Property $property) => DeleteProperty::run(actor($admin), $property)],
    'create a label' => [fn (User $admin) => SaveLabel::run(actor($admin), null, $labelInput('Neu'))],
    'change a label' => [fn (User $admin, Workflow $workflow, WorkItemType $type, Property $property, Label $label) => SaveLabel::run(actor($admin), $label, $labelInput('Neu'))],
    'delete a label' => [fn (User $admin, Workflow $workflow, WorkItemType $type, Property $property, Label $label) => DeleteLabel::run(actor($admin), $label)],
    'create a relation type' => [fn (User $admin) => SaveRelationType::run(actor($admin), null, $relationTypeInput('Neu'))],
    'change a relation type' => [fn (User $admin, Workflow $workflow, WorkItemType $type, Property $property, Label $label, RelationType $relationType) => SaveRelationType::run(actor($admin), $relationType, $relationTypeInput('Neu'))],
    'delete a relation type' => [fn (User $admin, Workflow $workflow, WorkItemType $type, Property $property, Label $label, RelationType $relationType) => DeleteRelationType::run(actor($admin), $relationType)],
    'create a resolution' => [fn (User $admin) => SaveResolution::run(actor($admin), null, ['label' => 'Neu'])],
    'change a resolution' => [fn (User $admin, Workflow $workflow, WorkItemType $type, Property $property, Label $label, RelationType $relationType, Resolution $resolution) => SaveResolution::run(actor($admin), $resolution, ['label' => 'Neu'])],
    'delete a resolution' => [fn (User $admin, Workflow $workflow, WorkItemType $type, Property $property, Label $label, RelationType $relationType, Resolution $resolution) => DeleteResolution::run(actor($admin), $resolution)],
    'switch the workflow of a project' => [fn (User $admin, Workflow $workflow, WorkItemType $type, Property $property, Label $label, RelationType $relationType, Resolution $resolution, Project $project) => AssignWorkflow::run(actor($admin), $project, ['workflow_id' => $workflow->id, 'mapping' => []])],
    'switch the types of a project' => [fn (User $admin, Workflow $workflow, WorkItemType $type, Property $property, Label $label, RelationType $relationType, Resolution $resolution, Project $project) => UpdateProject::run(actor($admin), $project, ['enabled_type_ids' => [$type->id], 'default_type_id' => $type->id])],
    'move the default type of a project' => [fn (User $admin, Workflow $workflow, WorkItemType $type, Property $property, Label $label, RelationType $relationType, Resolution $resolution, Project $project) => UpdateProject::run(actor($admin), $project, ['default_type_id' => $type->id])],
]);

it('lets only one of two workflows become the default', function () {
    $admin = User::factory()->admin()->create();
    $a = SaveWorkflow::run(actor($admin), null, WorkflowFixtures::agencyInput('A'));
    $b = SaveWorkflow::run(actor($admin), null, WorkflowFixtures::standardInput('B'));
    $defaultInput = fn (Workflow $workflow) => [...WorkflowFixtures::inputOf($workflow), 'is_default' => true];

    // connection 1: A becomes the default, the transaction stays open
    RaceConnections::hold(fn () => SaveWorkflow::run(actor($admin), $a, $defaultInput($a)));

    // connection 2: B wants the mark too and waits instead of taking it from the Standard workflow it still sees
    RaceConnections::expectLockWait(RaceConnections::second(fn () => SaveWorkflow::run(actor($admin), $b, $defaultInput($b))), 'organization');

    RaceConnections::release();

    // once A is the default, B takes the mark from A
    expect(RaceConnections::second(fn () => SaveWorkflow::run(actor($admin), $b, $defaultInput($b))))->toBeInstanceOf(Workflow::class)
        ->and(Workflow::query()->where('is_default', true)->pluck('id')->all())->toBe([$b->id])
        ->and(eventsOf(EventType::WorkflowUpdated, $a)->map(fn ($event) => $event->changes)->all())->toBe([
            ['is_default' => ['old' => false, 'new' => true]],
            ['is_default' => ['old' => true, 'new' => false]],
        ]);
});

it('checks a name under the lock, against the name another change has just saved', function (Closure $change) {
    $admin = User::factory()->admin()->create();
    $old = Workflow::factory()->create(['name' => 'Alt']);

    // connection 1: a new workflow Prüfung, the transaction stays open
    RaceConnections::hold(fn () => SaveWorkflow::run(actor($admin), null, WorkflowFixtures::agencyInput('Prüfung')));

    // it commits the moment connection 2 asks for the lock: a check before the lock would miss the name, and the
    // unique index would end the change with a server error
    RaceConnections::releaseBeforeLock('organization');
    $outcome = RaceConnections::second(fn () => $change($admin, $old));

    expect($outcome)->toBeInstanceOf(ValidationException::class);
    assert($outcome instanceof ValidationException);
    expect($outcome->errors())->toBe(['name' => [__('field.name.taken')]])
        ->and(Workflow::query()->orderBy('id')->pluck('name')->all())->toBe(['Standard', 'Alt', 'Prüfung']);
})->with([
    'a new workflow' => [fn (User $admin, Workflow $old) => SaveWorkflow::run(actor($admin), null, WorkflowFixtures::standardInput('prüfung'))],
    'a renamed workflow' => [fn (User $admin, Workflow $old) => SaveWorkflow::run(actor($admin), $old, [...WorkflowFixtures::inputOf($old), 'name' => 'PRÜFUNG'])],
]);

it('checks type names and property keys under the lock, against what another change has just saved', function (Closure $first, Closure $change, string $field, string $message) {
    $admin = User::factory()->admin()->create();
    $old = WorkItemType::factory()->create(['name' => 'Alt']);

    // connection 1: a new type Prüfung or a new property `customer`, the transaction stays open
    RaceConnections::hold(fn () => $first($admin));

    // it commits the moment connection 2 asks for the lock: a check before the lock would miss the name or key, and
    // the unique index would end the change with a server error
    RaceConnections::releaseBeforeLock('organization');
    $outcome = RaceConnections::second(fn () => $change($admin, $old));

    expect($outcome)->toBeInstanceOf(ValidationException::class);
    assert($outcome instanceof ValidationException);
    expect($outcome->errors())->toBe([$field => [__($message)]]);
})->with([
    'a new type' => [
        fn (User $admin) => SaveWorkItemType::run(actor($admin), null, $typeInput('Prüfung')),
        fn (User $admin) => SaveWorkItemType::run(actor($admin), null, $typeInput('prüfung')),
        'name', 'field.name.taken',
    ],
    'a renamed type' => [
        fn (User $admin) => SaveWorkItemType::run(actor($admin), null, $typeInput('Prüfung')),
        fn (User $admin, WorkItemType $old) => SaveWorkItemType::run(actor($admin), $old, $typeInput('PRÜFUNG')),
        'name', 'field.name.taken',
    ],
    'a new property' => [
        fn (User $admin) => SaveProperty::run(actor($admin), null, $propertyInput('customer')),
        fn (User $admin) => SaveProperty::run(actor($admin), null, $propertyInput('customer', 'Kundin')),
        'key', 'field.key.taken',
    ],
]);

it('keeps a type that has just become the default type of a project from being archived or deleted', function (Closure $change) {
    $admin = User::factory()->admin()->create();
    $type = WorkItemType::factory()->create(['name' => 'Alt']);
    $project = Project::factory()->identifier('WEB')->create();

    // connection 1: the type becomes the default type of WEB, the transaction stays open
    RaceConnections::hold(fn () => UpdateProject::run(actor($admin), $project, ['default_type_id' => $type->id]));
    RaceConnections::releaseBeforeLock('organization');
    $outcome = RaceConnections::second(fn () => $change($admin, $type));

    expect($outcome)->toBeInstanceOf(Problem::class);
    assert($outcome instanceof Problem);
    expect($outcome->reason)->toBe('default_type')
        ->and($outcome->extensions)->toBe(['projects' => ['WEB']])
        ->and($type->fresh()?->archived_at)->toBeNull();
})->with([
    'archive it' => [fn (User $admin, WorkItemType $type) => SaveWorkItemType::run(actor($admin), $type, $typeInput('Alt', ['archived_at' => '2026-10-31']))],
    'delete it' => [fn (User $admin, WorkItemType $type) => DeleteWorkItemType::run(actor($admin), $type)],
]);

it('never deletes a workflow that a project switches to meanwhile', function () {
    $admin = User::factory()->admin()->create();
    $workflow = Workflow::factory()->create(['name' => 'Agentur-Freigabe']);
    $project = Project::factory()->identifier('WEB')->create();

    // connection 1: WEB gets the workflow, the transaction stays open
    RaceConnections::hold(fn () => AssignWorkflow::run(actor($admin), $project, ['workflow_id' => $workflow->id, 'mapping' => []]));

    // connection 2: the deletion waits for the lock instead of finding the workflow unused (and failing on the foreign key)
    RaceConnections::expectLockWait(RaceConnections::second(fn () => DeleteWorkflow::run(actor($admin), $workflow)), 'organization');

    // once WEB has it, the workflow is in use
    RaceConnections::release();
    $outcome = RaceConnections::second(fn () => DeleteWorkflow::run(actor($admin), $workflow));

    expect($outcome)->toBeInstanceOf(Problem::class);
    assert($outcome instanceof Problem);
    expect($outcome->reason)->toBe('in_use')
        ->and($outcome->extensions)->toBe(['projects' => ['WEB']])
        ->and($project->fresh()?->workflow_id)->toBe($workflow->id);
});

it('checks labels, relation type names and resolution labels under the lock, against what another change has just saved', function (Closure $first, Closure $change, string $field) {
    $admin = User::factory()->admin()->create();
    $label = Label::factory()->create(['name' => 'Alt']);
    $relationType = RelationType::factory()->create(['name' => 'Alt']);
    $resolution = Resolution::factory()->create(['label' => 'Alt']);

    // connection 1: a new entry Prüfung, the transaction stays open
    RaceConnections::hold(fn () => $first($admin));

    // it commits the moment connection 2 asks for the lock: a check before the lock would miss the name, and the
    // unique index would end the change with a server error
    RaceConnections::releaseBeforeLock('organization');
    $outcome = RaceConnections::second(fn () => $change($admin, $label, $relationType, $resolution));

    expect($outcome)->toBeInstanceOf(ValidationException::class);
    assert($outcome instanceof ValidationException);
    expect($outcome->errors())->toBe([$field => [__("field.{$field}.taken")]]);
})->with([
    'a new label' => [
        fn (User $admin) => SaveLabel::run(actor($admin), null, $labelInput('Prüfung')),
        fn (User $admin) => SaveLabel::run(actor($admin), null, $labelInput('prüfung')),
        'name',
    ],
    'a renamed label' => [
        fn (User $admin) => SaveLabel::run(actor($admin), null, $labelInput('Prüfung')),
        fn (User $admin, Label $label) => SaveLabel::run(actor($admin), $label, $labelInput('PRÜFUNG')),
        'name',
    ],
    'a new relation type' => [
        fn (User $admin) => SaveRelationType::run(actor($admin), null, $relationTypeInput('Prüfung')),
        fn (User $admin) => SaveRelationType::run(actor($admin), null, $relationTypeInput('prüfung')),
        'name',
    ],
    'a renamed relation type' => [
        fn (User $admin) => SaveRelationType::run(actor($admin), null, $relationTypeInput('Prüfung')),
        fn (User $admin, Label $label, RelationType $relationType) => SaveRelationType::run(actor($admin), $relationType, $relationTypeInput('PRÜFUNG')),
        'name',
    ],
    'a new resolution' => [
        fn (User $admin) => SaveResolution::run(actor($admin), null, ['label' => 'Prüfung']),
        fn (User $admin) => SaveResolution::run(actor($admin), null, ['label' => 'prüfung']),
        'label',
    ],
    'a renamed resolution' => [
        fn (User $admin) => SaveResolution::run(actor($admin), null, ['label' => 'Prüfung']),
        fn (User $admin, Label $label, RelationType $relationType, Resolution $resolution) => SaveResolution::run(actor($admin), $resolution, ['label' => 'PRÜFUNG']),
        'label',
    ],
]);

it('keeps exactly one default per category when two resolutions take it at once', function () {
    $admin = User::factory()->admin()->create();
    $done = Resolution::query()->where('label', 'Done')->sole();
    $duplicate = Resolution::query()->where('label', 'Duplicate')->sole();
    $cannotReproduce = Resolution::query()->where('label', 'Cannot reproduce')->sole();
    $defaultInput = fn (Resolution $resolution) => ['label' => $resolution->label, 'default_for' => 'completed'];

    // connection 1: Duplicate becomes the default for Completed, the transaction stays open
    RaceConnections::hold(fn () => SaveResolution::run(actor($admin), $duplicate, $defaultInput($duplicate)));

    // connection 2: Cannot reproduce wants the mark too and waits instead of taking it from Done, which it still sees
    RaceConnections::expectLockWait(RaceConnections::second(fn () => SaveResolution::run(actor($admin), $cannotReproduce, $defaultInput($cannotReproduce))), 'organization');

    RaceConnections::release();

    // once Duplicate is the default, Cannot reproduce takes the mark from Duplicate
    expect(RaceConnections::second(fn () => SaveResolution::run(actor($admin), $cannotReproduce, $defaultInput($cannotReproduce))))->toBeInstanceOf(Resolution::class)
        ->and(Resolution::query()->where('default_for', 'completed')->pluck('id')->all())->toBe([$cannotReproduce->id])
        ->and(eventsOf(EventType::ResolutionUpdated, $done)->map(fn ($event) => $event->changes)->all())->toBe([
            ['default_for' => ['old' => 'completed', 'new' => null]],
        ])
        ->and(eventsOf(EventType::ResolutionUpdated, $duplicate)->map(fn ($event) => $event->changes)->all())->toBe([
            ['default_for' => ['old' => null, 'new' => 'completed']],
            ['default_for' => ['old' => 'completed', 'new' => null]],
        ]);
});

it('keeps a resolution that has just become the default from being deleted', function () {
    $admin = User::factory()->admin()->create();
    $done = Resolution::query()->where('label', 'Done')->sole();
    $duplicate = Resolution::query()->where('label', 'Duplicate')->sole();

    // connection 1: Duplicate becomes the default for Completed, the transaction stays open
    RaceConnections::hold(fn () => SaveResolution::run(actor($admin), $duplicate, ['label' => 'Duplicate', 'default_for' => 'completed']));

    // it commits the moment connection 2 asks for the lock: a check before the lock would still see Done as the default
    RaceConnections::releaseBeforeLock('organization');
    $outcome = RaceConnections::second(fn () => DeleteResolution::run(actor($admin), $duplicate));

    expect($outcome)->toBeInstanceOf(Problem::class);
    assert($outcome instanceof Problem);
    expect($outcome->reason)->toBe('is_default')
        ->and(Resolution::query()->where('default_for', 'completed')->pluck('id')->all())->toBe([$duplicate->id])
        ->and($done->fresh()?->default_for)->toBeNull();
});
