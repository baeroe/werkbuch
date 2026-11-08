<?php

use App\Access\ProjectRole;
use App\Actions\WorkItems\AddRelation;
use App\Actions\WorkItems\BulkUpdateWorkItems;
use App\Actions\WorkItems\ChangeWorkItemType;
use App\Actions\WorkItems\CountWorkItems;
use App\Actions\WorkItems\CreateWorkItem;
use App\Actions\WorkItems\GetWorkItem;
use App\Actions\WorkItems\GroupWorkItems;
use App\Actions\WorkItems\TransitionWorkItem;
use App\Actions\WorkItems\UpdateWorkItem;
use App\Domain\Filter\CoreField;
use App\Domain\Filter\Op;
use App\Domain\Views\DisplaySchema;
use App\Domain\Views\GroupBy;
use App\Domain\Views\Layout;
use App\Domain\Views\SortSpec;
use App\Domain\WorkItems\Priority;
use App\Models\Label;
use App\Models\Project;
use App\Models\Property;
use App\Models\RelationType;
use App\Models\Template;
use App\Models\User;
use App\Models\WorkItem;
use App\Models\WorkItemType;
use App\OpenApi\ItemQueryDocs;
use App\Views\ItemQueryInput;
use App\Views\Shorthand;
use Tests\Support\OpenApi\Contract;
use Tests\Support\OpenApi\Document;

/*
 * The work items in the document (Phase 12, Task 10): the items and their changes, the queries (`GET /work-items`,
 * `POST /work-items/query|groups|counts`), the bulk edit, relations, watchers and the history. What Scramble cannot read
 * from the actions the controllers say with `#[Body]`, `#[Answer]` and `ItemQueryDocs`; this file holds that against
 * the code:
 *  (a) every operation, its success status and its tag are the ones the server answers,
 *  (b) the resources say what they hold: a lean item without its texts, the free keys of `values`, the embeds of
 *      `include`, a relation entry and a history entry; a full and a lean item with `null` in every nullable field keep
 *      the contract (the contract of every test checks the answers),
 *  (c) the keys of a body and of the short form are the ones the server reads (BODY_KEYS, GroupWorkItems::KEYS,
 *      CountWorkItems::KEYS, PATCH_KEYS, Shorthand::KEYS, the FIELDS of the actions); a body is closed only where the
 *      action refuses unknown keys (K2); `Filter`, `Display` and `SortSpec` name what the schemas take (Op, CoreField),
 *  (d) a client can send every key the document names (a full body per operation, `Contract::sentKeys`, K15),
 *  (e) the answers that are not `{data: WorkItem}` and the conflict of a description say what they are.
 */

$tags = ['WorkItems', 'Relations', 'Subscribers', 'History'];

/** The JSON schema of the body of an operation. */
$body = fn (string $method, string $path): array => Document::operation($method, $path)['requestBody']['content']['application/json']['schema'] ?? [];

/** The schema of the answer of an operation with this status, `$ref`s not followed. */
$answer = fn (string $method, string $path, int $status): array => Document::operation($method, $path)['responses'][(string) $status]['content']['application/json']['schema'] ?? [];

$schema = fn (string $name): array => Document::get()['components']['schemas'][$name];

/** The operations of the item tags: `"<METHOD> <path>" => success status`. */
$operations = [
    'GET /work-items' => 200, 'POST /work-items' => 201, 'POST /work-items/bulk' => 200, 'POST /work-items/query' => 200,
    'POST /work-items/groups' => 200, 'POST /work-items/counts' => 200, 'GET /work-items/{item}' => 200,
    'PATCH /work-items/{item}' => 200, 'DELETE /work-items/{item}' => 204, 'POST /work-items/{item}/transition' => 200,
    'PUT /work-items/{item}/type' => 200, 'POST /work-items/{item}/archive' => 200, 'POST /work-items/{item}/restore' => 200,
    'GET /work-items/{item}/subscribers' => 200, 'PUT /work-items/{item}/subscription' => 200, 'DELETE /work-items/{item}/subscription' => 200,
    'GET /work-items/{item}/relations' => 200, 'POST /work-items/{item}/relations' => 201, 'DELETE /relations/{relation}' => 204,
    'GET /work-items/{item}/history' => 200, 'POST /projects/{project}/redistribute-ranks' => 200,
];

it('documents the success status the server answers for every item operation', function () use ($operations, $tags) {
    foreach ($operations as $key => $status) {
        [$method, $path] = explode(' ', $key, 2);
        $operation = Document::operation($method, $path);
        $success = array_map('intval', array_values(array_filter(array_keys($operation['responses']), fn ($s) => (int) $s >= 200 && (int) $s < 300)));

        expect($success)->toBe([$status], $key)
            ->and(in_array($operation['tags'][0], $tags, true))->toBeTrue($key)
            ->and($operation['summary'] ?? '')->not->toBe('', $key);
    }

    $tagged = array_keys(array_filter(Document::operations(), fn ($op) => array_intersect($op['tags'] ?? [], $tags) !== []));
    expect($tagged)->toEqualCanonicalizing(array_keys($operations));
});

it('names the resource every answer carries', function () use ($answer, $operations) {
    foreach ([
        'POST /work-items' => 'WorkItemResource', 'GET /work-items/{item}' => 'WorkItemResource', 'PATCH /work-items/{item}' => 'WorkItemResource',
        'POST /work-items/{item}/transition' => 'WorkItemResource', 'PUT /work-items/{item}/type' => 'WorkItemResource',
        'POST /work-items/{item}/archive' => 'WorkItemResource', 'PUT /work-items/{item}/subscription' => 'WorkItemResource',
        'POST /work-items/{item}/relations' => 'RelationEntryResource',
    ] as $key => $resource) {
        [$method, $path] = explode(' ', $key, 2);
        $ref = $answer($method, $path, $operations[$key])['properties']['data']['$ref'] ?? '';

        expect(basename((string) $ref))->toBe($resource, $key);
    }

    foreach ([
        'GET /work-items' => 'WorkItemResource', 'POST /work-items/query' => 'WorkItemResource', 'GET /work-items/{item}/history' => 'HistoryEntryResource',
        'GET /work-items/{item}/relations' => 'RelationEntryResource', 'GET /work-items/{item}/subscribers' => 'UserResource',
    ] as $key => $resource) {
        [$method, $path] = explode(' ', $key, 2);

        expect(basename((string) ($answer($method, $path, 200)['properties']['data']['items']['$ref'] ?? '')))->toBe($resource, $key);
    }
});

it('describes a work item, its free values and what a lean one leaves out', function () use ($schema) {
    $item = $schema('WorkItemResource');
    $properties = $item['properties'];

    // a lean item (P17, A174) comes without its texts: they are never required
    foreach (['description', 'description_json', 'values_markdown', 'children', 'type', 'workflow', 'relations', 'attachments'] as $key) {
        expect(in_array($key, $item['required'], true))->toBeFalse($key);
    }

    expect($item['required'])->toContain('values', 'label_ids', 'children_progress', 'subscribed')
        ->and($properties['values']['type'])->toBe('object')
        ->and(array_column($properties['values']['additionalProperties']['anyOf'], '$ref'))->toContain('#/components/schemas/RichTextDocument')
        ->and($properties['values_markdown']['additionalProperties'])->toBe(['type' => 'string'])
        ->and($properties['description_json']['anyOf'])->toBe([['$ref' => '#/components/schemas/RichTextDocument'], ['type' => 'null']])
        ->and($properties['label_ids']['items']['type'])->toBe('string')
        ->and($properties['priority']['enum'])->toBe(array_column(Priority::cases(), 'value'))
        ->and($properties['due_date']['format'])->toBe('date')
        ->and($properties['updated_at']['format'])->toBe('date-time');

    // what `include` embeds is the resource of each, never a loose array
    expect($properties['children']['items']['$ref'])->toBe('#/components/schemas/WorkItemResource')
        ->and($properties['type']['$ref'])->toBe('#/components/schemas/WorkItemTypeResource')
        ->and($properties['workflow']['$ref'])->toBe('#/components/schemas/WorkflowResource')
        ->and($properties['relations']['items']['$ref'])->toBe('#/components/schemas/RelationEntryResource')
        ->and($properties['attachments']['items']['$ref'])->toBe('#/components/schemas/AttachmentResource');
});

it('describes a relation entry as its reader sees it, without a warning of Scramble', function () use ($schema) {
    $entry = $schema('RelationEntryResource');

    expect($entry['required'])->toBe(['relation', 'other', 'direction', 'hidden'])
        ->and($entry['properties']['hidden']['type'])->toBe('boolean')
        ->and($entry['properties']['direction']['enum'])->toBe(['outward', 'inward'])
        ->and($entry['properties']['other']['anyOf'])->toBe([['$ref' => '#/components/schemas/WorkItemResource'], ['type' => 'null']])
        ->and($entry['properties']['relation']['required'])->toBe(['id', 'type_id', 'source_id', 'target_id'])
        ->and(array_filter(Document::diagnostics(), fn (string $d) => str_contains($d, 'RelationEntryResource')))->toBe([]);
});

it('describes a history entry without an empty schema', function () use ($schema) {
    $entry = $schema('HistoryEntryResource')['properties'];

    expect($entry['states']['anyOf'][0]['required'])->toBe(['old', 'new'])
        ->and($entry['states']['anyOf'][0]['properties']['old']['required'])->toBe(['id', 'name', 'category'])
        ->and($entry['changes']['x-werkbuch-open'])->toBeTrue()
        ->and($entry['template']['anyOf'][0]['required'])->toBe(['id', 'name'])
        ->and($entry['reason']['type'])->toBe(['string', 'null'])
        ->and($entry['via']['type'])->toBe(['string', 'null'])
        ->and($entry['comment_id']['type'])->toBe(['string', 'null'])
        ->and($entry['occurred_at']['format'])->toBe('date-time')
        ->and(Contract::emptySchemas(Document::get(), ['WorkItems', 'Relations', 'Subscribers', 'History']))->toBe([]);
});

it('describes the filter, the display and the sort with the values the server takes', function () use ($schema) {
    $filter = $schema('Filter');
    $condition = $filter['properties']['conditions']['items'];
    $fields = $condition['properties']['field']['anyOf'];
    $display = $schema('Display');
    $sort = $schema('SortSpec');

    expect($filter['required'])->toBe(['version', 'conditions'])
        ->and($filter['properties']['version']['const'])->toBe(1)
        ->and($filter['properties']['conditions']['maxItems'])->toBe(50)
        ->and($condition['required'])->toBe(['field', 'op'])
        ->and($condition['properties']['op']['enum'])->toBe(array_column(Op::cases(), 'value'))
        ->and($fields[0]['enum'])->toBe(array_column(CoreField::cases(), 'value'))
        ->and($fields[1]['pattern'])->toBe('^property:')
        ->and($display['required'])->toBe(['layout', 'group_by', 'sort', 'fields', 'show_sub_items'])
        ->and($display['properties']['layout']['enum'])->toBe(array_column(Layout::cases(), 'value'))
        ->and($display['properties']['group_by']['enum'])->toBe(array_column(GroupBy::cases(), 'value'))
        ->and($display['properties']['fields']['items']['anyOf'][0]['enum'])->toBe(DisplaySchema::FIELDS)
        ->and($display['properties']['sort']['$ref'])->toBe('#/components/schemas/SortSpec')
        ->and($sort['properties']['field']['anyOf'][0]['enum'])->toBe(SortSpec::CORE)
        ->and($sort['properties']['direction']['enum'])->toBe(['asc', 'desc']);
});

it('documents the query string of GET /work-items with the short form', function () {
    $parameters = collect(Document::operation('GET', '/work-items')['parameters'])->keyBy('name');
    $short = array_map(fn (string $key) => "filter[{$key}]", Shorthand::KEYS);

    expect($parameters->keys()->all())->toEqualCanonicalizing(['view', ...$short, 'sort', 'show_sub_items', 'include_archived', 'lean', 'cursor', 'per_page'])
        ->and($parameters->every(fn (array $p) => $p['in'] === 'query' && ($p['description'] ?? '') !== ''))->toBeTrue()
        ->and($parameters['sort']['description'])->toContain('-due_date')
        ->and($parameters['per_page']['schema']['maximum'])->toBe(100)
        ->and($parameters['lean']['schema']['enum'])->toBe([1, 0])
        ->and($parameters['filter[archived]']['schema']['enum'])->toBe(['true', 'false'])
        // a key that takes several values is a list, in the query string separated by commas
        ->and($parameters['filter[state]']['schema'])->toBe(['type' => 'array', 'items' => ['type' => 'string']])
        ->and($parameters['filter[state]']['style'])->toBe('form')
        ->and($parameters['filter[state]']['explode'])->toBeFalse()
        ->and($parameters['filter[project]']['schema'])->toBe(['type' => 'string'])
        ->and(collect($parameters)->filter(fn (array $p) => $p['schema']['type'] === 'array')->keys()->all())
        ->toEqualCanonicalizing(['filter[assignee]', 'filter[created_by]', 'filter[type]', 'filter[state]', 'filter[state_category]', 'filter[priority]', 'filter[label]']);

    $include = collect(Document::operation('GET', '/work-items/{item}')['parameters'])->firstWhere('name', 'include');
    expect($include['schema']['items']['enum'])->toBe(GetWorkItem::INCLUDES)
        ->and($include['explode'])->toBeFalse();
});

it('gives the query parameters the document shows', function () {
    $shown = collect(Document::operation('GET', '/work-items')['parameters'])->keyBy('name');
    $given = ItemQueryDocs::queryParameters();

    expect(array_keys($given))->toBe($shown->keys()->all());
    foreach ($given as $name => $parameter) {
        expect($parameter['schema'])->toBe($shown[$name]['schema'], $name)
            ->and($parameter['description'])->toBe($shown[$name]['description'], $name);
    }
});

/** Per operation with a JSON body: the keys the server reads, the required ones, and whether it refuses others. */
$bodies = [
    'POST /work-items' => [CreateWorkItem::FIELDS, ['project_id', 'title'], false],
    'PATCH /work-items/{item}' => [UpdateWorkItem::FIELDS, [], false],
    'POST /work-items/{item}/transition' => [TransitionWorkItem::FIELDS, ['to_state_id'], false],
    'PUT /work-items/{item}/type' => [ChangeWorkItemType::FIELDS, ['type_id'], false],
    'POST /work-items/{item}/relations' => [AddRelation::FIELDS, ['type_id', 'target_id'], false],
    'POST /work-items/bulk' => [['ids', 'patch'], ['ids', 'patch'], false],
    'POST /work-items/query' => [ItemQueryInput::BODY_KEYS, [], true],
    'POST /work-items/groups' => [GroupWorkItems::KEYS, ['group_by'], true],
    'POST /work-items/counts' => [CountWorkItems::KEYS, ['filters'], true],
];

it('documents the keys the server reads and closes only the bodies that refuse others', function () use ($bodies, $body) {
    foreach ($bodies as $key => [$keys, $required, $closed]) {
        [$method, $path] = explode(' ', $key, 2);
        $schema = $body($method, $path);

        expect(array_keys($schema['properties']))->toEqualCanonicalizing($keys, $key)
            ->and($schema['required'] ?? [])->toBe($required, $key)
            // K2: an action that passes over unknown keys keeps its body open; one that answers 422 closes it
            ->and($schema['x-werkbuch-open'] ?? false)->toBe(! $closed, $key);
    }

    $patch = $body('POST', '/work-items/bulk')['properties']['patch'];
    $shorthand = $body('POST', '/work-items/query')['properties']['shorthand'];

    expect(array_keys($patch['properties']))->toBe(BulkUpdateWorkItems::PATCH_KEYS)
        ->and($patch['additionalProperties'])->toBeFalse()
        ->and($patch['minProperties'])->toBe(1)
        ->and(array_keys($shorthand['properties']))->toBe(Shorthand::KEYS)
        ->and($body('POST', '/work-items/query')['properties']['filter']['anyOf'][0]['$ref'])->toBe('#/components/schemas/Filter')
        ->and($body('POST', '/work-items/counts')['properties']['filters']['additionalProperties']['$ref'])->toBe('#/components/schemas/Filter')
        ->and($body('POST', '/work-items/counts')['properties']['filters']['description'])
        ->toContain('at most '.CountWorkItems::MAX_CONDITIONS_TOTAL.' conditions over all of them');
});

it('says on create which fields mean "not given" with null', function () use ($body) {
    $create = $body('POST', '/work-items')['properties'];
    $update = $body('PATCH', '/work-items/{item}')['properties'];

    foreach (['type_id', 'priority', 'state_id', 'assignee_id', 'parent_id', 'template_id', 'label_ids', 'values', 'start_date'] as $field) {
        expect(in_array('null', (array) $create[$field]['type'], true))->toBeTrue($field);
    }

    // a change clears with null what can be empty, nothing else
    expect((array) $update['assignee_id']['type'])->toContain('null')
        ->and((array) $update['priority']['type'])->not->toContain('null')
        ->and((array) $update['title']['type'])->not->toContain('null')
        ->and($update['base_description_version']['minimum'])->toBe(1);
});

it('lets a client send every key the document names', function () use ($bodies, $body) {
    $mara = User::factory()->create(['name' => 'Mara']);
    $lene = User::factory()->create(['name' => 'Lene']);
    $web = Project::factory()->member($mara, ProjectRole::Admin)->member($lene, ProjectRole::Member)->create(['lead_id' => $mara->id]);
    $task = WorkItemType::query()->where('name', 'Task')->firstOrFail();
    $epic = WorkItemType::query()->where('is_epic', true)->firstOrFail();
    $notes = Property::factory()->create(['key' => 'notes_x', 'label' => 'Notes', 'field_type' => 'rich_text']);
    $task->typeProperties()->create(['property_id' => $notes->id, 'required' => false, 'position' => 0]);
    $bug = WorkItemType::query()->where('name', 'Bug')->firstOrFail();
    $label = Label::factory()->create();
    $parent = WorkItem::factory()->for($web)->epic()->create();
    $template = Template::factory()->create(['project_id' => $web->id, 'created_by' => $mara->id]);
    $states = $web->workflow->states;
    $started = $states->firstWhere('category.value', 'started') ?? $states[1];
    $done = $states->firstWhere('category.value', 'completed');
    $relates = RelationType::query()->where('built_in', 'relates')->firstOrFail();
    $this->actingAs($mara);

    $item = $this->postJson('/api/v1/work-items', [
        'project_id' => $web->identifier, 'type_id' => $task->id, 'title' => 'Full', 'description' => 'Some **text**.', 'priority' => 'high',
        'label_ids' => [$label->id], 'start_date' => '2026-11-02', 'due_date' => '2026-11-30', 'assignee_id' => $lene->id, 'parent_id' => $parent->key,
        'values' => ['notes_x' => 'A note'], 'state_id' => $started->id, 'template_id' => $template->id,
    ])->assertCreated()->json('data');
    $this->postJson('/api/v1/work-items', [
        'project_id' => $web->id, 'title' => 'Json', 'description_json' => ['type' => 'doc', 'content' => [['type' => 'paragraph', 'content' => [['type' => 'text', 'text' => 'x']]]]],
        'type_id' => null, 'priority' => null, 'label_ids' => null, 'start_date' => null, 'due_date' => null, 'assignee_id' => null, 'parent_id' => null,
        'values' => null, 'state_id' => null, 'template_id' => null,
    ])->assertCreated();

    $this->patchJson("/api/v1/work-items/{$item['id']}", [
        'title' => 'Fuller', 'description' => 'Other.', 'base_description_version' => $item['description_version'], 'priority' => 'low',
        'label_ids' => null, 'start_date' => null, 'due_date' => '2026-12-01', 'assignee_id' => null, 'parent_id' => null,
        'values' => ['notes_x' => null], 'rank' => 'a5', 'state_id' => $started->id, 'resolution_id' => null,
    ])->assertOk();
    $this->patchJson("/api/v1/work-items/{$item['id']}", ['description_json' => null])->assertOk();
    $this->postJson("/api/v1/work-items/{$item['id']}/transition", ['to_state_id' => $done->id, 'resolution_id' => null])->assertOk();
    $other = $this->postJson('/api/v1/work-items', ['project_id' => $web->id, 'title' => 'Other'])->assertCreated()->json('data');
    $this->putJson("/api/v1/work-items/{$other['id']}/type", ['type_id' => $bug->id, 'values' => []])->assertOk();
    $this->postJson("/api/v1/work-items/{$other['id']}/relations", ['type_id' => $relates->id, 'target_id' => $item['key']])->assertCreated();
    $this->postJson('/api/v1/work-items/bulk', ['ids' => [$other['key']], 'patch' => [
        'state_id' => $started->id, 'resolution_id' => null, 'assignee_id' => $lene->id, 'priority' => 'urgent', 'label_ids' => [],
        'add_label_ids' => [$label->id], 'remove_label_ids' => null, 'start_date' => null, 'due_date' => '2026-12-24', 'archived' => false,
    ]])->assertOk()->assertJsonPath('rejected.0.reason', 'not_archived');

    $filter = ['version' => 1, 'conditions' => [
        ['field' => 'priority', 'op' => 'in', 'value' => ['urgent', 'high']],
        ['field' => 'due_date', 'op' => 'between', 'value' => ['today', ['relative' => '+2w']]],
        ['field' => 'assignee', 'op' => 'is_not_empty'],
        ['field' => 'epic', 'op' => 'is', 'value' => false],
        ['field' => 'title', 'op' => 'contains', 'value' => 'Ful'],
    ]];
    $this->postJson('/api/v1/work-items/query', [
        'view_id' => null, 'filter' => $filter, 'shorthand' => ['project' => $web->identifier, 'assignee' => 'none', 'archived' => 'false', 'q' => null],
        'q' => 'Full', 'sort' => ['field' => 'due_date', 'direction' => 'desc'], 'show_sub_items' => true, 'group_by' => 'priority', 'group' => 'high',
        'include_archived' => 0, 'lean' => '1', 'cursor' => null, 'per_page' => 10,
    ])->assertOk();
    $this->postJson('/api/v1/work-items/groups', [
        'view_id' => null, 'filter' => $filter, 'q' => null, 'sort' => null, 'show_sub_items' => false, 'group_by' => 'parent', 'include_archived' => true,
    ])->assertOk();
    $this->postJson('/api/v1/work-items/counts', ['filters' => ['open' => ['version' => 1, 'conditions' => []], '0' => $filter], 'include_archived' => false])
        ->assertOk()->assertJsonStructure(['data' => ['open', '0']]);

    foreach ($bodies as $key => [$keys]) {
        [$method, $path] = explode(' ', $key, 2);
        $missing = array_diff(array_keys($body($method, $path)['properties']), Contract::sentKeys($method, $path));

        expect($missing)->toBe([], "{$key} was never sent with: ".implode(', ', $missing));
    }
});

it('keeps the contract for a full and a lean item with null in every nullable field', function () {
    $mara = User::factory()->create();
    $web = Project::factory()->member($mara, ProjectRole::Admin)->create(['lead_id' => $mara->id]);
    // no description, no resolution, assignee, dates, parent, template, closing or archive: every nullable field null
    $item = WorkItem::factory()->for($web)->create(['description' => null]);
    $this->actingAs($mara);

    $full = $this->getJson("/api/v1/work-items/{$item->key}?include=children,type,workflow,relations,attachments")->assertOk()->json('data');
    $lean = $this->postJson('/api/v1/work-items/query', ['lean' => true])->assertOk()->json('data.0');

    expect($full)->toHaveKeys(['description', 'description_json', 'values_markdown', 'children', 'type', 'workflow', 'relations', 'attachments'])
        ->and($full['description_json'])->toBeNull()
        ->and($full['children_progress'])->toBeNull()
        ->and(array_intersect(array_keys($lean), ['description', 'description_json', 'values_markdown']))->toBe([])
        ->and(Contract::violations())->toBe([]);
});

it('does not promise that a template fills the fields of a new item', function () use ($body) {
    // CreateWorkItem reads the template only to copy its images (A337) and names it in the event (A352)
    $description = $body('POST', '/work-items')['properties']['template_id']['description'];

    expect($description)->not->toContain('leaves out')
        ->and($description)->toContain('images')
        ->and($description)->toContain('title');
});

it('describes the answers without the item wrapper', function () use ($answer) {
    $bulk = $answer('POST', '/work-items/bulk', 200);
    $groups = $answer('POST', '/work-items/groups', 200)['properties']['data'];
    $counts = $answer('POST', '/work-items/counts', 200)['properties']['data'];

    expect($bulk['required'])->toBe(['updated', 'rejected'])
        ->and($bulk['properties']['rejected']['items']['required'])->toBe(['id', 'reason'])
        ->and($groups['required'])->toBe(['group_by', 'total', 'groups'])
        ->and($groups['properties']['group_by']['enum'])->toBe(array_column(GroupBy::cases(), 'value'))
        ->and($groups['properties']['groups']['items']['required'])->toBe(['key', 'count'])
        ->and($counts['additionalProperties'])->toBe(['type' => 'integer', 'minimum' => 0]);
});

it('gives the conflict of a description the item as it is now', function () {
    $problem = Document::get()['components']['schemas']['Problem']['properties']['current'];

    expect(array_column($problem['anyOf'], '$ref'))->toContain('#/components/schemas/WorkItemResource')
        ->and($problem['description'])->toContain('description_conflict');

    $operation = Document::operation('PATCH', '/work-items/{item}');
    expect(($operation['description'] ?? '').json_encode($operation['requestBody']))->toContain('description_conflict');
});

it('has no body for the operations that take none', function () {
    foreach (['GET /work-items', 'GET /work-items/{item}', 'DELETE /work-items/{item}', 'POST /work-items/{item}/archive', 'POST /work-items/{item}/restore',
        'GET /work-items/{item}/subscribers', 'PUT /work-items/{item}/subscription', 'DELETE /work-items/{item}/subscription',
        'GET /work-items/{item}/relations', 'DELETE /relations/{relation}', 'GET /work-items/{item}/history'] as $key) {
        [$method, $path] = explode(' ', $key, 2);

        expect(array_key_exists('requestBody', Document::operation($method, $path) ?? []))->toBeFalse($key);
    }
});
