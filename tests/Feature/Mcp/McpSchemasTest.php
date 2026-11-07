<?php

use App\Actions\Projects\ListProjects;
use App\Actions\Users\ListUsers;
use App\Mcp\Support\McpAction;
use App\Mcp\Support\McpArguments;
use App\Mcp\Support\McpResult;
use App\Mcp\Support\ToolSchema;
use App\Models\User;
use App\OpenApi\Components;
use App\OpenApi\ContentSchemas;
use App\OpenApi\ItemQueryDocs;
use App\OpenApi\ListParameters;
use App\OpenApi\PathParameters;
use App\Support\Actor;
use App\Support\ListSpec;
use Opis\JsonSchema\Validator;
use Tests\Feature\Access\MatrixWorld;
use Tests\Support\Mcp\McpClient;
use Tests\Support\Mcp\ToolRows;
use Tests\Support\Mcp\TwinServer;
use Tests\Support\OpenApi\Document;

/*
 * The input schemas of the MCP tools (phase 13, task 3b; K8): the body of an action is the body of its REST twin, the
 * query of an action with a `GET` twin is the query of the twin, every twin exists, every schema is JSON Schema whose
 * `$defs` resolve, and nothing of the OpenAPI extensions or examples reaches `tools/list`. The checks run over both
 * suites (the tools of /mcp and those of the twin server).
 */

beforeEach(fn () => TwinServer::serve());

$noop = fn (Actor $actor, McpArguments $args): McpResult => McpResult::done();

/** A schema in a canonical form: decoded as arrays, the keys of every object sorted. */
$canonical = function (mixed $schema) use (&$canonical): mixed {
    $schema = json_decode((string) json_encode($schema), true);
    if (! is_array($schema)) {
        return $schema;
    }
    $schema = array_map($canonical, $schema);
    if (! array_is_list($schema)) {
        ksort($schema);
    }

    return $schema;
};

/**
 * The names of the components a schema names (`#/$defs/<Name>`), also through the components it names.
 *
 * @param  array<string, mixed>  $defs
 * @return list<string>
 */
$named = function (mixed $schema, array $defs): array {
    $found = [];
    $queue = [$schema];
    while ($queue !== []) {
        preg_match_all('~"\$ref":"#\\\\/\$defs\\\\/(\w+)"~', (string) json_encode(array_shift($queue)), $matches);
        foreach ($matches[1] as $name) {
            if (! in_array($name, $found, true)) {
                $found[] = $name;
                $queue[] = $defs[$name] ?? null;
            }
        }
    }
    sort($found);

    return $found;
};

/** @return list<array{0: string, 1: McpAction, 2: array<string, mixed>}> tool name, action, input schema of the tool */
$actions = function (string $suite): array {
    $all = [];
    foreach (ToolRows::tools($suite) as $tool) {
        foreach ($tool->actionNames() as $name) {
            $all[] = [$tool->name(), $tool->actionNamed($name), $tool->toArray()['inputSchema']];
        }
    }

    return $all;
};

/**
 * A body schema without the defaults of `per_page` and `lean`, the page a tool reads unless the call says otherwise.
 *
 * @param  array<string, mixed>  $schema
 * @return array<string, mixed>
 */
$withoutPage = function (array $schema): array {
    foreach (['per_page', 'lean'] as $key) {
        if (isset($schema['properties'][$key])) {
            unset($schema['properties'][$key]['default']);
        }
    }

    return $schema;
};

it('describes every input like the body of its REST twin', function (string $suite) use ($actions, $canonical, $named, $withoutPage) {
    $checked = 0;
    $inputs = 0;

    foreach ($actions($suite) as [$tool, $action, $schema]) {
        // every body follows a twin; only get-upload-url has none (spec 6.2)
        $inputs += $action->input !== null && $tool !== 'get-upload-url' ? 1 : 0;
        if ($action->input === null || $action->twin === null) {
            continue;
        }

        [$method, $uri] = ToolRows::twin($action);
        $body = Document::operation($method, $uri)['requestBody']['content']['application/json']['schema'] ?? null;
        expect($body)->toBeArray("{$tool}:{$action->name} names {$action->twin}, which takes no body");

        $branch = collect($schema['properties']['input']['anyOf'])->first(fn (array $branch) => in_array($action->name, explode(', ', $branch['title']), true));
        unset($branch['title']);
        $defs = $schema['$defs'] ?? [];
        $names = $named($branch, $defs);
        $mine = [...$branch, ...$names === [] ? [] : ['$defs' => array_intersect_key($defs, array_flip($names))]];

        // only the page of MCP is its own (K8, ToolSchema::paged): the defaults of `per_page` and `lean` of a body
        expect($canonical($withoutPage($mine)))->toBe($canonical($withoutPage(ToolSchema::compact($body))), "{$tool}:{$action->name}");
        $checked++;
    }

    expect($checked)->toBe($inputs)
        ->and($inputs)->toBe($suite === 'twins' ? 4 : $inputs);
})->with(array_keys(ToolRows::SUITES));

it('takes the query of its REST twin', function (string $suite) use ($actions) {
    $checked = [];

    foreach ($actions($suite) as [$tool, $action]) {
        if ($action->twin === null || ! str_starts_with($action->twin, 'GET ')) {
            continue;
        }

        [$method, $uri] = ToolRows::twin($action);
        $query = [];
        $filters = [];
        $documented = [];
        foreach (Document::operation($method, $uri)['parameters'] ?? [] as $parameter) {
            if ($parameter['in'] === 'query') {
                preg_match('/^filter\[(.+)]$/', $parameter['name'], $filter) === 1 ? $filters[] = $filter[1] : $query[] = $parameter['name'];
                $documented[$parameter['name']] = [...$parameter['schema'], 'description' => $parameter['description'] ?? null];
            }
        }
        if ($filters !== []) {
            $query[] = 'filter';
        }

        $path = ToolRows::pathArguments($action);
        $arguments = array_keys(array_diff_key($action->parameters, array_flip($path)));
        sort($query);
        sort($arguments);
        $where = "{$tool}:{$action->name}";

        expect($arguments)->toBe($query, $where)
            ->and(array_keys($action->parameters['filter']['properties'] ?? []))->toEqualCanonicalizing($filters, $where);

        // type, enum and description of each argument are those of the document; only the default page size is MCP's own
        $without = fn (array $schema): array => array_diff_key($schema, ['default' => true]);
        foreach ($action->parameters as $name => $schema) {
            if (! in_array($name, $path, true) && $name !== 'filter') {
                expect($without($schema))->toEqual($without($documented[$name]), "{$where} {$name}");
            }
        }
        foreach ($action->parameters['filter']['properties'] ?? [] as $name => $schema) {
            expect($without($schema))->toEqual($without($documented["filter[{$name}]"]), "{$where} filter[{$name}]");
        }
        $checked[] = $where;
    }

    // every GET twin is checked, these at least (the areas bring more)
    expect($checked)->toContain(...($suite === 'twins' ? ['twins:list-users', 'twins:members'] : ['whoami:call', 'search:call']));
})->with(array_keys(ToolRows::SUITES));

it('takes the placeholders of its REST twin as required references', function (string $suite) use ($actions) {
    $twins = [];
    $checked = [];

    foreach ($actions($suite) as [$tool, $action]) {
        if ($action->twin === null) {
            continue;
        }
        $twins[] = "{$tool}:{$action->name}";

        foreach (ToolRows::pathArguments($action) as $placeholder => $argument) {
            $where = "{$tool}:{$action->name} {$argument}";
            expect($action->parameters[$argument] ?? null)->toBe(ToolSchema::reference($placeholder), "{$where} is described as the placeholder of its twin")
                ->and($action->required)->toContain($argument);
            $checked[] = $where;
        }
    }

    // every twin is looked at, of every method; of the twin server a GET and a DELETE twin have placeholders
    expect($twins)->toContain(...($suite === 'twins' ? ['twins:members', 'twins:query', 'manage-twins:delete-view'] : ['whoami:call', 'search:call']));
    if ($suite === 'twins') {
        expect($checked)->toBe(['twins:members project', 'manage-twins:delete-view view']);
    }
})->with(array_keys(ToolRows::SUITES));

it('names an existing twin', function (string $suite) use ($actions) {
    $twins = array_values(array_filter(array_map(fn (array $entry) => $entry[1]->twin, $actions($suite))));

    expect($twins)->not->toBeEmpty();
    foreach ($twins as $twin) {
        [$method, $uri] = explode(' ', $twin, 2);
        expect(Document::operation($method, $uri))->toBeArray($twin);
    }
})->with(array_keys(ToolRows::SUITES));

it('makes every tool schema valid JSON Schema', function (string $suite) use ($named) {
    $w = MatrixWorld::build();
    $validator = new Validator;
    $validator->setMaxErrors(10);

    foreach (ToolRows::tools($suite) as $tool) {
        $schema = $tool->toArray()['inputSchema'];
        $defs = $schema['$defs'] ?? [];
        $object = json_decode((string) json_encode($schema));

        // every name points to a definition, and every definition is named
        expect($named($schema, $defs))->toBe(array_keys($defs), $tool->name());

        // the arguments of every row of the tool are valid against it: opis loads the schema and follows its $defs
        foreach (array_keys(ToolRows::rows($suite)) as $key) {
            if (str_starts_with($key, $tool->name().':')) {
                $error = $validator->validate(json_decode((string) json_encode((object) ToolRows::arguments($suite, $key, $w))), $object)->error();
                expect($error?->message())->toBeNull($key);
            }
        }
        // and an action it does not have is not
        if (is_array($schema['properties']) && isset($schema['properties']['action'])) {
            expect($validator->validate(json_decode('{"action": "nope"}'), $object)->isValid())->toBeFalse($tool->name());
        }
    }
})->with(array_keys(ToolRows::SUITES));

it('drops the extensions and examples', function (string $suite) {
    $json = (string) json_encode(McpClient::for($this, apiToken(User::factory()->create(), ['read', 'write', 'mcp']), path: ToolRows::path($suite))->tools());

    // the body of `create-view` of the twin server carries the extension in the document
    expect((string) json_encode(ContentSchemas::view()))->toContain('x-werkbuch-open')
        ->and($json)->not->toContain('x-werkbuch-');
})->with(array_keys(ToolRows::SUITES));

it('drops the examples of a body an input reaches', function () use ($noop) {
    // no body of a tool carries examples yet; Problem does, on the lists of its extensions
    $problem = Components::schemas()['Problem']['properties'];
    $body = ['type' => 'object', 'properties' => ['states' => $problem['states'], 'projects' => $problem['projects']]];
    $input = ToolSchema::input([new McpAction('call', 'Takes a body.', $noop, input: $body)]);

    expect((string) json_encode($body))->toContain('"examples"')
        ->and($input['properties']['input']['anyOf'][0]['properties'])->toHaveKeys(['states', 'projects'])
        ->and((string) json_encode($input))->not->toContain('"examples"');
});

it('gives a list read by a body the page of MCP as its defaults', function () {
    $paged = ToolSchema::paged(ItemQueryDocs::query());
    $schema = collect(ToolRows::tools('werkbuch'))->first(fn ($tool) => $tool->name() === 'work-items')->toArray()['inputSchema'];
    $query = collect($schema['properties']['input']['anyOf'])->firstWhere('title', 'query');

    // the document says 100 and nothing for `lean`; the tool reads 25 lean items (K8) and its schema says so
    expect(ItemQueryDocs::query()['properties']['per_page']['default'])->toBe(100)
        ->and(ItemQueryDocs::query()['properties']['lean'])->not->toHaveKey('default')
        ->and($paged['properties']['per_page']['default'])->toBe(McpAction::PER_PAGE)
        ->and($paged['properties']['lean']['default'])->toBeTrue()
        ->and($query['properties']['per_page']['default'])->toBe(McpAction::PER_PAGE)
        ->and($query['properties']['lean']['default'])->toBeTrue()
        // a body without them stays as it is
        ->and(ToolSchema::paged(ItemQueryDocs::counts()))->toBe(ItemQueryDocs::counts());
});

it('builds the input of a tool from its actions', function () use ($noop) {
    $page = ['type' => 'integer', 'minimum' => 1];
    $schema = ToolSchema::input([
        new McpAction('list', 'Lists them.', $noop, parameters: ['per_page' => $page, 'lean' => ['type' => 'boolean'], 'q' => ['type' => 'string']], defaults: ['lean' => true]),
        new McpAction('other', 'Lists others.', $noop, parameters: ['per_page' => $page, 'lean' => ['type' => 'boolean'], 'q' => ['type' => 'integer']]),
        new McpAction('query', 'Asks a body.', $noop, input: ItemQueryDocs::query(), required: ['input']),
        new McpAction('again', 'Asks the same body.', $noop, input: ItemQueryDocs::query()),
        new McpAction('view', 'Creates a view.', $noop, input: ContentSchemas::view(), required: ['input']),
    ]);

    expect($schema['required'])->toBe(['action'])
        ->and($schema['properties']['action']['enum'])->toBe(['list', 'other', 'query', 'again', 'view'])
        ->and($schema['properties']['action']['description'])->toBe("What to do:\n- `list`: Lists them.\n- `other`: Lists others.\n"
            ."- `query`: Asks a body. Needs `input`.\n- `again`: Asks the same body.\n- `view`: Creates a view. Needs `input`.")
        // the same schema once with the default all actions have; different ones as anyOf; a default only some have goes
        ->and($schema['properties']['per_page'])->toBe([...$page, 'default' => McpAction::PER_PAGE])
        ->and($schema['properties']['q'])->toBe(['anyOf' => [['title' => 'list', 'type' => 'string'], ['title' => 'other', 'type' => 'integer']]])
        ->and($schema['properties']['lean'])->toBe(['type' => 'boolean'])
        // the bodies: one branch each, titled with the actions that take it
        ->and(array_column($schema['properties']['input']['anyOf'], 'title'))->toBe(['query, again', 'view'])
        // every component once, also one only a component names (Display → SortSpec), as #/$defs/<Name>
        ->and(array_keys($schema['$defs']))->toBe(['Display', 'Filter', 'SortSpec'])
        ->and($schema['properties']['input']['anyOf'][1]['properties']['filter']['$ref'])->toBe('#/$defs/Filter')
        ->and($schema['$defs']['Display']['properties']['sort']['$ref'])->toBe('#/$defs/SortSpec');

    // one action: no `action`, its own arguments required; nothing to take: an object without properties
    $one = ToolSchema::input([new McpAction('call', 'One.', $noop, parameters: ['item' => ['type' => 'string']], required: ['item'])]);
    expect(json_encode($one))->toBe('{"type":"object","properties":{"item":{"type":"string"}},"required":["item"]}')
        ->and(json_encode(ToolSchema::input([new McpAction('call', 'Nothing.', $noop)])))->toBe('{"type":"object","properties":{}}');
});

it('defaults where every action that takes the argument agrees', function () use ($noop) {
    $lean = ['type' => 'boolean'];
    $agree = ToolSchema::input([
        new McpAction('a', 'A.', $noop, parameters: ['lean' => $lean], defaults: ['lean' => true]),
        new McpAction('b', 'B.', $noop, parameters: ['lean' => $lean], defaults: ['lean' => true]),
        new McpAction('c', 'C.', $noop),
    ]);
    $differ = ToolSchema::input([
        new McpAction('a', 'A.', $noop, parameters: ['lean' => $lean], defaults: ['lean' => true]),
        new McpAction('b', 'B.', $noop, parameters: ['lean' => $lean], defaults: ['lean' => false]),
    ]);

    expect($agree['properties']['lean'])->toBe([...$lean, 'default' => true])
        ->and($differ['properties']['lean'])->toBe($lean);
});

it('compacts a schema with its own defs', function () {
    $compact = ToolSchema::compact([
        'type' => 'object',
        'x-werkbuch-open' => true,
        'properties' => [
            // a property may be called like a keyword that goes elsewhere
            'examples' => ['type' => 'string', 'examples' => ['a']],
            'sort' => ['anyOf' => [['$ref' => '#/components/schemas/SortSpec'], ['type' => 'null']]],
            'any' => [],
            'map' => ['type' => 'object', 'properties' => [], 'additionalProperties' => []],
            'closed' => ['type' => 'object', 'additionalProperties' => false],
            'list' => ['type' => 'array', 'items' => ['type' => 'string'], 'default' => []],
            'other' => ['$ref' => '#/elsewhere'],
        ],
    ]);

    expect(json_encode($compact))->toBe('{"type":"object","properties":{"examples":{"type":"string"},"sort":{"anyOf":[{"$ref":"#\/$defs\/SortSpec"},{"type":"null"}]},'
        .'"any":{},"map":{"type":"object","properties":{},"additionalProperties":{}},"closed":{"type":"object","additionalProperties":false},"list":{"type":"array","items":{"type":"string"},"default":[]},"other":{"$ref":"#\/elsewhere"}},'
        .'"$defs":{"SortSpec":'.json_encode(ToolSchema::compact(Components::schemas()['SortSpec'])).'}}')
        ->and(fn () => ToolSchema::compact(['$ref' => '#/components/schemas/WorkItemResource']))->toThrow(InvalidArgumentException::class, 'WorkItemResource');
});

it('takes the query of a list from its spec', function () {
    $users = ToolSchema::list(ListUsers::spec());
    $projects = ToolSchema::list(ListProjects::spec());
    $rest = ListParameters::query(ListUsers::spec());

    expect(array_keys($users))->toBe(['filter', 'cursor', 'per_page', 'sort'])
        // filters by name with the schema of the document: a list as an array, a flag as 1 or 0
        ->and($users['filter']['properties'])->toBe([
            'type' => [...$rest['filter[type]']['schema'], 'description' => $rest['filter[type]']['description']],
            'disabled' => ['type' => 'integer', 'enum' => [1, 0], 'description' => $rest['filter[disabled]']['description']],
        ])
        ->and($users['sort'])->toBe(['type' => 'string', 'description' => ListParameters::sortDescription(ListUsers::spec())])
        ->and($users['cursor'])->toBe([...$rest['cursor']['schema'], 'description' => $rest['cursor']['description']])
        ->and($users['per_page'])->toBe([...$rest['per_page']['schema'], 'description' => 'The rows per page.', 'default' => McpAction::PER_PAGE])
        ->and($projects['include'])->toBe([...ListParameters::query(ListProjects::spec())['include']['schema'], 'description' => 'Relations to load with each row.'])
        ->and($projects['include']['items']['enum'])->toBe(['members'])
        // a fixed list pages, nothing else
        ->and(array_keys(ToolSchema::list(ListSpec::fixed())))->toBe(['cursor', 'per_page']);
});

it('describes a reference like the placeholder of the document', function () {
    expect(ToolSchema::reference('project'))->toBe(['type' => 'string', 'description' => 'The project: its ULID (any case), its identifier (`WEB`) or a former identifier.'])
        ->and(ToolSchema::reference('item')['description'])->toBe('The work item: its ULID (any case) or its key (`WEB-12`, any case, also with a former identifier of its project).')
        ->and(ToolSchema::reference('pageVersion'))->toBe(['type' => 'string', 'description' => 'The ULID of the page version (any case).', 'pattern' => PathParameters::ULID]);

    // the document says the same, and for an item also that a GET by a former key moves on
    $parameter = fn (string $uri, string $name): array => collect(Document::operation('GET', $uri)['parameters'])->firstWhere('name', $name);
    expect($parameter('projects/{project}', 'project')['description'])->toBe(ToolSchema::reference('project')['description'])
        ->and($parameter('work-items/{item}', 'item')['description'])->toBe(substr(ToolSchema::reference('item')['description'], 0, -2)
            .'; a `GET` by a former key answers 301 to the current one).');
});

it('names ULIDs of several kinds by one schema', function () {
    $reference = fn (string $placeholder) => new McpAction($placeholder, 'x', fn () => McpResult::done(), parameters: ['id' => ToolSchema::reference($placeholder)], path: [$placeholder => 'id']);
    $schema = ToolSchema::input([$reference('workflow'), $reference('label')]);
    $other = ToolSchema::input([$reference('workflow'), $reference('project')]);

    expect($schema['properties']['id'])->toBe(['type' => 'string', 'description' => 'The ULID of the entry the action names (any case).', 'pattern' => PathParameters::ULID])
        // a reference that is no plain ULID keeps its own schema
        ->and(array_keys($other['properties']['id']))->toBe(['anyOf']);
});

it('names only the ULIDs of placeholders by one schema', function () {
    $ulid = fn (string $text) => ['type' => 'string', 'description' => $text, 'pattern' => PathParameters::ULID];
    // `bot_id` is no placeholder of the twin: its two meanings stay two
    $action = fn (string $name, string $text) => new McpAction($name, 'x', fn () => McpResult::done(), parameters: ['bot_id' => $ulid($text)]);
    $schema = ToolSchema::input([$action('a', 'The bot that answers.'), $action('b', 'The bot that is invited.')]);

    expect(array_keys($schema['properties']['bot_id']))->toBe(['anyOf'])
        ->and(array_column($schema['properties']['bot_id']['anyOf'], 'description'))->toBe(['The bot that answers.', 'The bot that is invited.']);
});

it('titles the branches of an argument that differs with the actions that take them', function () {
    $action = fn (string $name, string $text) => new McpAction($name, 'x', fn () => McpResult::done(), parameters: ['sort' => ['type' => 'string', 'description' => $text]]);
    $schema = ToolSchema::input([$action('list-a', 'By name.'), $action('list-b', 'By label.'), $action('list-c', 'By name.')]);

    expect($schema['properties']['sort']['anyOf'])->toBe([
        ['title' => 'list-a, list-c', 'type' => 'string', 'description' => 'By name.'],
        ['title' => 'list-b', 'type' => 'string', 'description' => 'By label.'],
    ]);
});

it('leaves the echoes of the answer out of a body', function () {
    $tools = (string) json_encode(McpClient::for($this, apiToken(User::factory()->create(), ['read', 'write', 'mcp']))->tools());
    $document = (string) json_encode(Document::operation('PATCH', 'organization')['requestBody']);

    // the document keeps them (the body stays open, a client may send them back); the tool schemas do not
    expect($document)->toContain('"readOnly":true')
        ->and($tools)->toContain('manage-organization')
        ->and(str_contains($tools, '"readOnly":'))->toBeFalse();
});
