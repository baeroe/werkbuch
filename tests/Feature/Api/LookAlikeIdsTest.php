<?php

use App\Access\ProjectRole;
use App\Actions\Favorites\ToggleFavorite;
use App\Actions\Invitations\InviteUser;
use App\Actions\Projects\AddMember;
use App\Actions\Projects\AssignWorkflow;
use App\Actions\Projects\CreateProject;
use App\Actions\Projects\UpdateProject;
use App\Actions\Properties\SaveProperty;
use App\Actions\Users\CreateBot;
use App\Actions\Users\UpdateUser;
use App\Actions\Workflows\SaveWorkflow;
use App\Actions\WorkItemTypes\SaveWorkItemType;
use App\Exceptions\Problem;
use App\Http\Resources\PropertyResource;
use App\Http\Resources\WorkItemTypeResource;
use App\Models\Project;
use App\Models\Property;
use App\Models\PropertyOption;
use App\Models\User;
use App\Models\Workflow;
use App\Models\WorkflowState;
use App\Models\WorkItemType;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\ValidationException;
use Tests\Support\WorkflowFixtures;

/*
 * IDs that equal a stored ULID only under the collation (utf8mb4_unicode_ci treats a fullwidth digit like the digit):
 * they would pass `exists`, `whereKey` and the foreign keys, so every field that names a row by its ULID takes only a
 * canonical one (A96). Local ids of new states and options stay free, and only a strict match keeps a row. Tested at
 * the actions: REST would hand them over unchanged (TrimStrings leaves them alone), but an action is the contract.
 */

/** The ULID with a fullwidth zero in front: the same row for the database, another text for PHP. */
$lookAlike = fn (string $ulid): string => '０'.substr($ulid, 1);

/** The first error of a field of a refused call. */
$errorAt = function (Closure $call, string $field): ?string {
    try {
        $call();
    } catch (ValidationException $exception) {
        return $exception->errors()[$field][0] ?? null;
    } catch (Problem $problem) {
        return $problem->errors[$field][0] ?? null;
    }

    return null;
};

it('takes the database for a look-alike as the same ULID', function () use ($lookAlike) {
    // the premise of every test below: without it they would pass for the wrong reason
    $workflow = Workflow::default();

    expect(Workflow::query()->whereKey($lookAlike($workflow->id))->exists())->toBeTrue()
        ->and($lookAlike($workflow->id))->not->toBe($workflow->id);
});

it('refuses look-alike IDs when a project is created', function (Closure $input, string $field, string $message) use ($lookAlike, $errorAt) {
    $mara = User::factory()->create();

    expect($errorAt(fn () => CreateProject::run(actor($mara), ['name' => 'Website', 'identifier' => 'WEB', ...$input($lookAlike, $mara)]), $field))
        ->toBe(__($message))
        ->and(Project::query()->count())->toBe(0);
})->with([
    'workflow' => [fn (Closure $alike) => ['workflow_id' => $alike(Workflow::default()->id)], 'workflow_id', 'field.workflow_id.unknown'],
    'a type' => [fn (Closure $alike) => ['enabled_type_ids' => [$alike(WorkItemType::query()->where('name', 'Task')->sole()->id)]], 'enabled_type_ids', 'field.enabled_type_ids.unknown'],
    'the default type' => [fn (Closure $alike) => ['default_type_id' => $alike(WorkItemType::query()->where('name', 'Task')->sole()->id)], 'default_type_id', 'field.default_type_id.enabled'],
    'the lead' => [fn (Closure $alike, User $mara) => ['lead_id' => $alike($mara->id)], 'lead_id', 'field.lead.invalid'],
]);

it('refuses look-alike IDs when a project changes', function (Closure $input, string $field, string $message) use ($lookAlike, $errorAt) {
    $mara = User::factory()->create();
    $web = CreateProject::run(actor($mara), ['name' => 'Website', 'identifier' => 'WEB']);
    $before = [$web->fresh()?->lead_id, $web->fresh()?->default_type_id];

    expect($errorAt(fn () => UpdateProject::run(actor($mara), $web, $input($lookAlike, $mara)), $field))->toBe(__($message))
        ->and([$web->fresh()?->lead_id, $web->fresh()?->default_type_id])->toBe($before);
})->with([
    'a type' => [fn (Closure $alike) => ['enabled_type_ids' => [$alike(WorkItemType::query()->where('name', 'Bug')->sole()->id)]], 'enabled_type_ids', 'field.enabled_type_ids.unknown'],
    'the default type' => [fn (Closure $alike) => ['default_type_id' => $alike(WorkItemType::query()->where('name', 'Bug')->sole()->id)], 'default_type_id', 'field.default_type_id.enabled'],
    'the lead' => [fn (Closure $alike, User $mara) => ['lead_id' => $alike($mara->id)], 'lead_id', 'field.lead.invalid'],
]);

it('refuses a look-alike workflow and look-alike states when the workflow of a project is switched', function () use ($lookAlike, $errorAt) {
    $mara = User::factory()->create();
    $web = CreateProject::run(actor($mara), ['name' => 'Website', 'identifier' => 'WEB']);
    $agency = Workflow::factory()->create(['name' => 'Agentur-Freigabe']);
    [$old, $new] = [Workflow::default()->states[0]->id, $agency->states[0]->id];

    expect($errorAt(fn () => AssignWorkflow::run(actor($mara), $web, ['workflow_id' => $lookAlike($agency->id)]), 'workflow_id'))
        ->toBe(__('field.workflow_id.unknown'))
        // the mapping is compared strictly: neither a key nor a target that only the collation would match
        ->and($errorAt(fn () => AssignWorkflow::run(actor($mara), $web, ['workflow_id' => $agency->id, 'mapping' => [$lookAlike($old) => $new]]), 'mapping.'.$lookAlike($old)))
        ->toBe(__('field.mapping.unknown_state'))
        ->and($errorAt(fn () => AssignWorkflow::run(actor($mara), $web, ['workflow_id' => $agency->id, 'mapping' => [$old => $lookAlike($new)]]), "mapping.{$old}"))
        ->toBe(__('field.mapping.target'))
        ->and($web->fresh()?->workflow_id)->toBe(Workflow::default()->id);
});

it('refuses a look-alike property of a type, which the unique index would have turned into a server error', function () use ($lookAlike, $errorAt) {
    $admin = User::factory()->admin()->create();
    $bug = WorkItemType::query()->where('name', 'Bug')->sole();
    $effort = Property::query()->where('key', 'effort')->sole();
    $input = (new WorkItemTypeResource($bug->load('typeProperties')))->resolve();
    $input['properties'] = [['property_id' => $lookAlike($effort->id), 'required' => true]];

    expect($errorAt(fn () => SaveWorkItemType::run(actor($admin), $bug, $input), 'properties.0.property_id'))->toBe(__('field.properties.unknown'))
        ->and($bug->typeProperties()->sole()->property_id)->toBe($effort->id);
});

it('never lets a look-alike take over a state of the workflow: it is a new state, the state it mimics goes', function () use ($lookAlike) {
    $admin = User::factory()->admin()->create();
    $workflow = SaveWorkflow::run(actor($admin), null, WorkflowFixtures::standardInput('Probe'));
    $input = WorkflowFixtures::inputOf($workflow);
    $todo = $input['states'][1]['id'];
    $input['states'][1]['id'] = $lookAlike($todo);

    $saved = SaveWorkflow::run(actor($admin), $workflow, $input)->fresh(['states']);
    $ids = $saved?->states->modelKeys() ?? [];

    expect($ids)->toHaveCount(6)->not->toContain($todo)
        ->and(WorkflowState::query()->whereRaw('id = binary ?', [$todo])->exists())->toBeFalse()
        ->and(WorkflowState::query()->whereRaw('id = binary ?', [$lookAlike($todo)])->exists())->toBeFalse()
        ->and($saved?->states[1]->name)->toBe('Todo');
});

it('refuses a mapping of a removed state under a look-alike key', function () use ($lookAlike, $errorAt) {
    $admin = User::factory()->admin()->create();
    $workflow = SaveWorkflow::run(actor($admin), null, WorkflowFixtures::standardInput('Probe'));
    $input = WorkflowFixtures::inputOf($workflow);
    $removed = $input['states'][1]['id'];
    array_splice($input['states'], 1, 1);
    $input['state_mapping'] = [$lookAlike($removed) => $input['states'][0]['id']];

    expect($errorAt(fn () => SaveWorkflow::run(actor($admin), $workflow, $input), 'state_mapping.'.$lookAlike($removed)))
        ->toBe(__('field.mapping.unknown_state'));
});

it('never lets a look-alike take over an option of the property: it is a new option, the option it mimics goes', function () use ($lookAlike) {
    $admin = User::factory()->admin()->create();
    $property = Property::factory()->dropdown(['Chrome', 'Firefox'])->create(['key' => 'browser']);
    // as a client sends it back: the settings come as an object
    $input = json_decode((string) json_encode((new PropertyResource($property->load('options')))->resolve()), true);
    $chrome = $input['options'][0]['id'];
    $input['options'][0]['id'] = $lookAlike($chrome);
    $input['default_value'] = $lookAlike($chrome);

    $saved = SaveProperty::run(actor($admin), $property, $input)->fresh(['options']);

    expect($saved?->options->modelKeys())->toHaveCount(2)->not->toContain($chrome)
        ->and(PropertyOption::query()->where('label', 'Chrome')->sole()->id)->toBe($saved?->default_value)
        ->and($saved?->default_value)->not->toBe($chrome);
});

it('refuses a look-alike responsible person of a bot', function () use ($lookAlike, $errorAt) {
    $admin = User::factory()->admin()->create();
    $kira = CreateBot::run(actor($admin), ['name' => 'Kira', 'handle' => 'kira']);

    expect($errorAt(fn () => CreateBot::run(actor($admin), ['name' => 'Otto', 'handle' => 'otto', 'owner_id' => $lookAlike($admin->id)]), 'owner_id'))
        ->toBe(__('field.owner_id.invalid'))
        ->and($errorAt(fn () => UpdateUser::run(actor($admin), $kira, ['owner_id' => $lookAlike($admin->id)]), 'owner_id'))
        ->toBe(__('field.owner_id.invalid'))
        ->and(User::query()->where('handle', 'otto')->exists())->toBeFalse();
});

it('refuses a look-alike member, a look-alike project of an invitation and a look-alike favorite', function () use ($lookAlike, $errorAt) {
    $admin = User::factory()->admin()->create();
    $web = CreateProject::run(actor($admin), ['name' => 'Website', 'identifier' => 'WEB']);
    $lene = User::factory()->create();

    expect($errorAt(fn () => AddMember::run(actor($admin), $web, ['user_id' => $lookAlike($lene->id), 'role' => ProjectRole::Member->value]), 'user_id'))
        ->toBe(__('field.user.inactive'))
        ->and($errorAt(fn () => InviteUser::run(actor($admin), [
            'email' => 'ida@example.com', 'org_role' => 'member', 'projects' => [['project_id' => $lookAlike($web->id), 'role' => 'member']],
        ]), 'projects.0.project_id'))->toBe(__('field.projects.unknown'))
        ->and(fn () => ToggleFavorite::run(actor($admin), ['kind' => 'project', 'id' => $lookAlike($web->id)]))->toThrow(Problem::class)
        ->and(DB::table('favorites')->count())->toBe(0);
});
