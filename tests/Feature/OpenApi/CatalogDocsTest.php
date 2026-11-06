<?php

use App\Actions\Automations\SaveAutomation;
use App\Actions\Favorites\ToggleFavorite;
use App\Actions\Labels\SaveLabel;
use App\Actions\Projects\AddMember;
use App\Actions\Projects\AssignWorkflow;
use App\Actions\Projects\CreateProject;
use App\Actions\Projects\UpdateMemberRole;
use App\Actions\Projects\UpdateProject;
use App\Actions\Properties\SaveProperty;
use App\Actions\RelationTypes\SaveRelationType;
use App\Actions\Resolutions\SaveResolution;
use App\Actions\Workflows\SaveWorkflow;
use App\Actions\WorkItemTypes\SaveWorkItemType;
use App\Models\Property;
use App\Models\User;
use App\Models\Workflow;
use App\Models\WorkItemType;
use Tests\Support\OpenApi\Contract;
use Tests\Support\OpenApi\Document;

/*
 * The project side and the catalogs in the document (Phase 12, Task 9): projects, members, favorites, automations,
 * workflows, state usage, types, properties, labels, relation types and resolutions. What Scramble cannot read from
 * the actions (their validation) the controllers say with `#[Body]` and `#[Answer]`; this file holds that against the
 * actions:
 *  (a) every operation, its success status and its tag are the ones the server answers,
 *  (b) the keys of a body are the ones the action reads (`FIELDS`), the required ones are what it requires,
 *  (c) a client can send every key the document names (a full body per operation, `Contract::sentKeys`, K15),
 *  (d) the answers that are not `{data}` say what they are, the extensions of a problem have a shape and an example.
 * The answers themselves are held against the document by the contract of every test (STRICT_TAGS).
 */

const CATALOG_TAGS = ['Projects', 'Members', 'Favorites', 'Automations', 'Workflows', 'StateUsage', 'WorkItemTypes', 'Properties', 'Labels', 'RelationTypes', 'Resolutions'];

/** The JSON schema of the body of an operation. */
$body = fn (string $method, string $path): array => Document::operation($method, $path)['requestBody']['content']['application/json']['schema'] ?? [];

/** The schema of the answer of an operation with this status, `$ref`s not followed. */
$answer = fn (string $method, string $path, int $status): array => Document::operation($method, $path)['responses'][(string) $status]['content']['application/json']['schema'] ?? [];

/** The operations of the catalog tags: `"<METHOD> <path>" => success status`. */
$operations = [
    'GET /projects' => 200, 'POST /projects' => 201, 'GET /projects/{project}' => 200, 'PATCH /projects/{project}' => 200,
    'DELETE /projects/{project}' => 202, 'POST /projects/{project}/archive' => 200, 'POST /projects/{project}/restore' => 200,
    'PUT /projects/{project}/workflow' => 200,
    'GET /projects/{project}/members' => 200, 'POST /projects/{project}/members' => 201, 'POST /projects/{project}/join' => 201,
    'PATCH /projects/{project}/members/{user}' => 200, 'DELETE /projects/{project}/members/{user}' => 204,
    'GET /favorites' => 200, 'POST /favorites/toggle' => 200,
    'GET /projects/{project}/automations' => 200, 'PUT /projects/{project}/automations/{key}' => 200,
    'GET /workflows' => 200, 'POST /workflows' => 201, 'GET /workflows/{workflow}' => 200, 'PUT /workflows/{workflow}' => 200, 'DELETE /workflows/{workflow}' => 204,
    'GET /state-usage' => 200,
    'GET /work-item-types' => 200, 'POST /work-item-types' => 201, 'GET /work-item-types/{workItemType}' => 200, 'PUT /work-item-types/{workItemType}' => 200, 'DELETE /work-item-types/{workItemType}' => 200,
    'GET /properties' => 200, 'POST /properties' => 201, 'GET /properties/{property}' => 200, 'PUT /properties/{property}' => 200, 'DELETE /properties/{property}' => 200,
    'GET /labels' => 200, 'POST /labels' => 201, 'GET /labels/{label}' => 200, 'PUT /labels/{label}' => 200, 'DELETE /labels/{label}' => 200,
    'GET /relation-types' => 200, 'POST /relation-types' => 201, 'GET /relation-types/{relationType}' => 200, 'PUT /relation-types/{relationType}' => 200, 'DELETE /relation-types/{relationType}' => 200,
    'GET /resolutions' => 200, 'POST /resolutions' => 201, 'GET /resolutions/{resolution}' => 200, 'PUT /resolutions/{resolution}' => 200, 'DELETE /resolutions/{resolution}' => 200,
];

it('documents the success status the server answers for every project and catalog operation', function () use ($operations) {
    foreach ($operations as $key => $status) {
        [$method, $path] = explode(' ', $key, 2);
        $operation = Document::operation($method, $path);
        $success = array_map('intval', array_values(array_filter(array_keys($operation['responses']), fn ($s) => (int) $s >= 200 && (int) $s < 300)));

        expect($success)->toBe([$status], $key)
            ->and(in_array($operation['tags'][0], CATALOG_TAGS, true))->toBeTrue($key);
    }

    $tagged = array_keys(array_filter(Document::operations(), fn ($op) => array_intersect($op['tags'] ?? [], CATALOG_TAGS) !== []));
    expect($tagged)->toEqualCanonicalizing(array_keys($operations));
});

it('names the resource every answer carries', function () use ($answer, $operations) {
    foreach ([
        'GET /projects/{project}' => 'ProjectResource', 'POST /projects' => 'ProjectResource', 'PATCH /projects/{project}' => 'ProjectResource',
        'PUT /projects/{project}/workflow' => 'ProjectResource', 'POST /projects/{project}/archive' => 'ProjectResource',
        'POST /projects/{project}/members' => 'ProjectMemberResource', 'POST /projects/{project}/join' => 'ProjectMemberResource',
        'PATCH /projects/{project}/members/{user}' => 'ProjectMemberResource',
        'GET /workflows/{workflow}' => 'WorkflowResource', 'POST /workflows' => 'WorkflowResource',
        'GET /work-item-types/{workItemType}' => 'WorkItemTypeResource', 'POST /properties' => 'PropertyResource',
        'GET /labels/{label}' => 'LabelResource', 'PUT /relation-types/{relationType}' => 'RelationTypeResource',
        'POST /resolutions' => 'ResolutionResource',
    ] as $key => $resource) {
        [$method, $path] = explode(' ', $key, 2);
        $status = $operations[$key];
        $ref = $answer($method, $path, $status)['properties']['data']['$ref'] ?? $answer($method, $path, $status)['$ref'] ?? '';

        expect(basename((string) $ref))->toBe($resource, $key);
    }
});

it('says what the resources hold that Scramble cannot read', function () {
    $schemas = Document::get()['components']['schemas'];
    $settings = $schemas['PropertyResource']['properties']['settings'];

    // a property without settings answers `{}`; a number has `decimals`, a dropdown `multiple`
    expect($settings['type'])->toBe('object')
        ->and($settings['x-werkbuch-open'])->toBeTrue()
        ->and(array_keys($settings['properties']))->toBe(['decimals', 'multiple'])
        ->and(array_column($schemas['PropertyResource']['properties']['default_value']['anyOf'], 'type'))->toContain('string', 'number', 'boolean', 'null', 'array')
        ->and($schemas['AutomationResource']['properties']['settings']['properties'])->toHaveKeys(['days', 'state_id'])
        ->and($schemas['AutomationResource']['properties']['settings']['x-werkbuch-open'])->toBeTrue();
});

it('gives the extensions of a problem a shape and an example', function () {
    $problem = Document::get()['components']['schemas']['Problem'];

    foreach (['states' => ['state_id', 'name', 'items'], 'projects' => null, 'issues' => ['code']] as $name => $required) {
        $property = $problem['properties'][$name];

        expect($property['type'])->toBe('array')
            ->and($property['description'])->not->toBe('')
            ->and($property['examples'])->toHaveCount(1)
            ->and($property['examples'][0])->not->toBeEmpty()
            ->and($property['items']['required'] ?? null)->toBe($required);
    }

    // the examples are what the server sends
    expect($problem['properties']['issues']['items']['properties']['code']['enum'])->toBe(['no_initial_state', 'no_completed_state', 'unreachable_state'])
        ->and($problem['properties']['projects']['items']['type'])->toBe('string');
});

it('names the problems the project and catalog operations can answer with', function () {
    // the conflicts that carry an extension are told in the text of the operation
    foreach ([
        ['PUT', '/workflows/{workflow}', ['invalid_workflow', 'state_in_use']],
        ['POST', '/workflows', ['invalid_workflow']],
        ['DELETE', '/workflows/{workflow}', ['in_use', 'default_workflow']],
        ['PUT', '/projects/{project}/workflow', ['mapping.<state_id>', 'states']],
        ['DELETE', '/work-item-types/{workItemType}', ['archived']],
        ['DELETE', '/relation-types/{relationType}', ['built_in']],
        ['DELETE', '/resolutions/{resolution}', ['is_default']],
    ] as [$method, $path, $words]) {
        $operation = Document::operation($method, $path);
        $text = ($operation['summary'] ?? '').' '.($operation['description'] ?? '').' '.json_encode($operation['requestBody'] ?? []).json_encode($operation['responses']['200'] ?? $operation['responses']['204'] ?? []);

        foreach ($words as $word) {
            expect($text)->toContain($word);
        }
    }
});

it('describes the mapping of the workflow switch as an open map of ULIDs', function () use ($body) {
    $mapping = $body('PUT', '/projects/{project}/workflow')['properties']['mapping'];

    expect($mapping['type'])->toContain('object')
        ->and($mapping['additionalProperties']['type'])->toBe('string')
        ->and($mapping['additionalProperties']['pattern'])->toBe('^[0-7][0-9A-HJKMNP-TV-Za-hjkmnp-tv-z]{25}$')
        ->and($mapping['description'])->toContain('Old state');
});

it('describes the answers without the data wrapper', function () use ($answer) {
    $favorite = $answer('POST', '/favorites/toggle', 200);
    $usage = $answer('GET', '/state-usage', 200);

    expect($favorite['required'])->toBe(['kind', 'id', 'favorite'])
        ->and($favorite['properties']['favorite']['type'])->toBe('boolean')
        ->and($favorite['properties']['kind']['enum'])->toBe(['project', 'view'])
        ->and($usage['required'])->toBe(['data'])
        ->and($usage['properties']['data']['items']['required'])->toBe(['state_id', 'items'])
        ->and($answer('DELETE', '/work-item-types/{workItemType}', 200)['properties']['outcome']['enum'])->toBe(['deleted', 'archived'])
        ->and($answer('DELETE', '/resolutions/{resolution}', 200)['properties']['outcome']['enum'])->toBe(['deleted', 'archived'])
        ->and($answer('DELETE', '/properties/{property}', 200)['required'])->toBe(['affected_items'])
        ->and($answer('DELETE', '/labels/{label}', 200)['required'])->toBe(['affected_items'])
        ->and($answer('DELETE', '/relation-types/{relationType}', 200)['required'])->toBe(['affected_relations']);
});

it('documents the query of GET /state-usage', function () {
    $parameters = collect(Document::operation('GET', '/state-usage')['parameters'])->keyBy('name');

    expect($parameters->keys()->all())->toContain('project', 'workflow')
        ->and($parameters['project']['in'])->toBe('query')
        ->and($parameters['project']['required'] ?? false)->toBeFalse()
        ->and($parameters['workflow']['description'])->toContain('workflow');
});

/** Per operation with a JSON body: the action, the required keys and the keys of the answer the action ignores. */
$project = ['id', 'archived_at', 'my_role', 'is_member', 'members'];
$bodies = [
    'POST /projects' => [CreateProject::class, ['name', 'identifier'], $project],
    'PATCH /projects/{project}' => [UpdateProject::class, [], $project],
    'PUT /projects/{project}/workflow' => [AssignWorkflow::class, ['workflow_id'], []],
    'POST /projects/{project}/members' => [AddMember::class, ['user_id', 'role'], ['project_id']],
    'PATCH /projects/{project}/members/{user}' => [UpdateMemberRole::class, ['role'], ['project_id', 'user_id']],
    'POST /favorites/toggle' => [ToggleFavorite::class, ['kind', 'id'], []],
    'PUT /projects/{project}/automations/{key}' => [SaveAutomation::class, ['enabled'], ['id', 'project_id', 'key']],
    'POST /workflows' => [SaveWorkflow::class, ['name', 'is_default', 'is_free', 'initial_state_id', 'states', 'transitions'], ['id']],
    'PUT /workflows/{workflow}' => [SaveWorkflow::class, ['name', 'is_default', 'is_free', 'initial_state_id', 'states', 'transitions'], ['id']],
    'POST /work-item-types' => [SaveWorkItemType::class, ['name', 'icon', 'tone', 'is_epic', 'properties'], ['id']],
    'PUT /work-item-types/{workItemType}' => [SaveWorkItemType::class, ['name', 'icon', 'tone', 'is_epic', 'properties'], ['id']],
    'POST /properties' => [SaveProperty::class, ['key', 'label', 'field_type'], ['id']],
    'PUT /properties/{property}' => [SaveProperty::class, ['key', 'label', 'field_type'], ['id']],
    'POST /labels' => [SaveLabel::class, ['name', 'color'], ['id']],
    'PUT /labels/{label}' => [SaveLabel::class, ['name', 'color'], ['id']],
    'POST /relation-types' => [SaveRelationType::class, ['name', 'outward_label'], ['id', 'built_in']],
    'PUT /relation-types/{relationType}' => [SaveRelationType::class, ['name', 'outward_label'], ['id', 'built_in']],
    'POST /resolutions' => [SaveResolution::class, ['label'], ['id', 'position']],
    'PUT /resolutions/{resolution}' => [SaveResolution::class, ['label'], ['id', 'position']],
];

it('documents the keys an action reads, no more and no fewer', function () use ($bodies, $body) {
    foreach ($bodies as $key => [$action, $required, $echoed]) {
        [$method, $path] = explode(' ', $key, 2);
        $schema = $body($method, $path);
        $properties = $schema['properties'];
        $read = array_keys(array_filter($properties, fn ($p) => ! ($p['readOnly'] ?? false)));
        $echo = array_keys(array_filter($properties, fn ($p) => ($p['readOnly'] ?? false) === true));

        // the keys the action reads (its FIELDS) are the writable ones; what the answer has on top and the action
        // ignores is documented read-only, so a client can send its own answer back (A75)
        expect($read)->toEqualCanonicalizing($action::FIELDS, $key)
            ->and($echo)->toEqualCanonicalizing($echoed, $key)
            ->and($schema['required'] ?? [])->toBe($required, $key)
            // K2: a body is closed only where the action refuses unknown keys with a 422; none of these does (they pass
            // over what they do not read), so every body stays open
            ->and($schema['x-werkbuch-open'] ?? false)->toBeTrue($key);
    }
});

it('says on create which project fields mean "not given" with null, and not on update', function () use ($body) {
    $create = $body('POST', '/projects')['properties'];
    $update = $body('PATCH', '/projects/{project}')['properties'];

    foreach (['lead_id', 'workflow_id', 'enabled_type_ids', 'default_type_id'] as $field) {
        expect((array) $create[$field]['type'])->toContain('null')
            ->and((array) $update[$field]['type'])->not->toContain('null');
    }
});

it('takes the answer back for what the actions ignore', function () use ($body) {
    // every read-only key of a body is a key of the answer it describes
    $schemas = Document::get()['components']['schemas'];
    $resources = [
        'ProjectResource' => ['POST /projects', 'PATCH /projects/{project}'],
        'ProjectMemberResource' => ['POST /projects/{project}/members', 'PATCH /projects/{project}/members/{user}'],
        'AutomationResource' => ['PUT /projects/{project}/automations/{key}'],
        'WorkflowResource' => ['POST /workflows', 'PUT /workflows/{workflow}'],
        'WorkItemTypeResource' => ['POST /work-item-types', 'PUT /work-item-types/{workItemType}'],
        'PropertyResource' => ['POST /properties', 'PUT /properties/{property}'],
        'LabelResource' => ['POST /labels', 'PUT /labels/{label}'],
        'RelationTypeResource' => ['POST /relation-types', 'PUT /relation-types/{relationType}'],
        'ResolutionResource' => ['POST /resolutions', 'PUT /resolutions/{resolution}'],
    ];

    foreach ($resources as $resource => $keys) {
        foreach ($keys as $key) {
            [$method, $path] = explode(' ', $key, 2);

            foreach ($body($method, $path)['properties'] as $name => $property) {
                if ($property['readOnly'] ?? false) {
                    expect($schemas[$resource]['properties'])->toHaveKey($name);
                }
            }
        }
    }

    // the nested read-only keys: a state, an option and a property of a type come back with their position
    $workflow = $body('PUT', '/workflows/{workflow}')['properties']['states']['items']['properties'];
    $property = $body('PUT', '/properties/{property}')['properties']['options']['items']['properties'];
    $type = $body('PUT', '/work-item-types/{workItemType}')['properties']['properties']['items']['properties'];

    expect($workflow['position']['readOnly'])->toBeTrue()
        ->and($property['position']['readOnly'])->toBeTrue()
        ->and($type['position']['readOnly'])->toBeTrue();
});

it('lets a client send every key the document names', function () use ($bodies, $body) {
    $admin = User::factory()->admin()->create();
    $lene = User::factory()->create();
    $tom = User::factory()->create();
    $this->actingAs($admin);

    $standard = Workflow::default();
    $effort = Property::query()->where('key', 'effort')->firstOrFail();

    // catalogs: create with every key, then take the answer back with a PUT
    $label = $this->postJson('/api/v1/labels', ['name' => 'Docs', 'color' => 'sky'])->assertCreated()->json('data');
    $this->putJson("/api/v1/labels/{$label['id']}", $label)->assertOk();
    $relation = $this->postJson('/api/v1/relation-types', ['name' => 'Fixes', 'outward_label' => 'fixes', 'inward_label' => 'is fixed by'])->assertCreated()->json('data');
    $this->putJson("/api/v1/relation-types/{$relation['id']}", $relation)->assertOk();
    $resolution = $this->postJson('/api/v1/resolutions', ['label' => 'Shipped', 'default_for' => null, 'archived_at' => null])->assertCreated()->json('data');
    $this->putJson("/api/v1/resolutions/{$resolution['id']}", $resolution)->assertOk();

    $property = $this->postJson('/api/v1/properties', [
        'key' => 'sprint_x', 'label' => 'Sprint', 'field_type' => 'dropdown', 'help' => 'The sprint.', 'default_value' => null,
        'settings' => ['multiple' => false], 'options' => [['label' => 'One', 'color' => 'sky'], ['id' => 'o_two', 'label' => 'Two', 'color' => 'moss', 'archived_at' => null]],
    ])->assertCreated()->json('data');
    $this->putJson("/api/v1/properties/{$property['id']}", $property)->assertOk();
    $this->putJson("/api/v1/properties/{$effort->id}", [
        'key' => 'effort', 'label' => 'Effort (h)', 'field_type' => 'number', 'help' => '', 'default_value' => 1.5, 'settings' => ['decimals' => 1], 'options' => null,
    ])->assertOk();

    $type = $this->postJson('/api/v1/work-item-types', [
        'name' => 'Idea', 'icon' => 'lightbulb', 'tone' => 'plum', 'description' => 'A thought.', 'is_epic' => false, 'archived_at' => null,
        'properties' => [['property_id' => $property['id'], 'required' => true]],
    ])->assertCreated()->json('data');
    $this->putJson("/api/v1/work-item-types/{$type['id']}", $type)->assertOk();

    $states = [
        ['id' => 'st_todo', 'name' => 'Todo', 'icon' => 'circle', 'category' => 'unstarted'],
        ['id' => 'st_doing', 'name' => 'Doing', 'icon' => 'half', 'category' => 'started'],
        ['id' => 'st_done', 'name' => 'Done', 'icon' => 'check', 'category' => 'completed'],
    ];
    $workflow = $this->postJson('/api/v1/workflows', [
        'name' => 'Short', 'description' => 'Three states.', 'is_default' => false, 'is_free' => false, 'initial_state_id' => 'st_todo',
        'states' => $states, 'transitions' => [['st_todo', 'st_doing'], ['st_doing', 'st_done']], 'state_mapping' => new stdClass,
    ])->assertCreated()->json('data');
    $this->putJson("/api/v1/workflows/{$workflow['id']}", $workflow)->assertOk();
    $this->putJson("/api/v1/workflows/{$workflow['id']}", [
        ...$workflow, 'state_mapping' => new stdClass,
    ])->assertOk();

    // projects
    $project = $this->postJson('/api/v1/projects', [
        'name' => 'Docs', 'identifier' => 'DOCX', 'description' => 'The docs.', 'image_url' => imageDataUrl(), 'visibility' => 'private', 'lead_id' => $lene->id,
        'workflow_id' => $standard->id, 'enabled_type_ids' => [$type['id'], WorkItemType::query()->value('id')], 'default_type_id' => $type['id'],
    ])->assertCreated()->json('data');
    $this->patchJson("/api/v1/projects/{$project['id']}", $project)->assertOk();
    $this->patchJson("/api/v1/projects/{$project['id']}", [
        'name' => 'Docs 2', 'identifier' => 'DOCY', 'description' => 'More.', 'image_url' => null, 'visibility' => 'public', 'lead_id' => $lene->id,
        'workflow_id' => $standard->id, 'enabled_type_ids' => [$type['id']], 'default_type_id' => $type['id'],
    ])->assertOk();

    $this->postJson("/api/v1/projects/{$project['id']}/members", ['user_id' => $tom->id, 'role' => 'member'])->assertCreated();
    $this->patchJson("/api/v1/projects/{$project['id']}/members/{$tom->id}", ['role' => 'viewer'])->assertOk();

    $this->putJson("/api/v1/projects/{$project['id']}/workflow", [
        'workflow_id' => $workflow['id'], 'mapping' => new stdClass,
    ])->assertOk();

    $closed = collect($workflow['states'])->firstWhere('category', 'canceled')['id'] ?? null;
    $this->putJson("/api/v1/projects/{$project['id']}/automations/auto_archive", [
        'enabled' => true, 'settings' => ['days' => 14],
    ])->assertOk();
    $this->putJson("/api/v1/projects/{$project['id']}/automations/auto_close", [
        'enabled' => false, 'settings' => ['days' => 30, 'state_id' => $closed],
    ])->assertOk();
    $this->putJson("/api/v1/projects/{$project['id']}/automations/close_parent", ['enabled' => true, 'settings' => new stdClass])->assertOk();

    $this->postJson('/api/v1/favorites/toggle', ['kind' => 'project', 'id' => $project['id']])->assertOk();
    $this->getJson("/api/v1/state-usage?project={$project['id']}")->assertOk();

    foreach ($bodies as $key => [, , $echoed]) {
        [$method, $path] = explode(' ', $key, 2);
        $named = array_keys(array_filter($body($method, $path)['properties'], fn ($p) => ! ($p['readOnly'] ?? false)));
        $missing = array_diff($named, Contract::sentKeys($method, $path));

        expect($missing)->toBe([], "{$key} was never sent with: ".implode(', ', $missing));
    }
});

it('has no body for the operations that take none', function () {
    foreach ([
        'GET /projects', 'GET /projects/{project}', 'DELETE /projects/{project}', 'POST /projects/{project}/archive', 'POST /projects/{project}/restore',
        'POST /projects/{project}/join', 'DELETE /projects/{project}/members/{user}', 'GET /workflows/{workflow}', 'DELETE /workflows/{workflow}',
        'DELETE /work-item-types/{workItemType}', 'DELETE /properties/{property}', 'DELETE /labels/{label}', 'DELETE /relation-types/{relationType}',
        'DELETE /resolutions/{resolution}', 'GET /state-usage',
    ] as $key) {
        [$method, $path] = explode(' ', $key, 2);

        expect(array_key_exists('requestBody', Document::operation($method, $path)))->toBeFalse($key);
    }
});
