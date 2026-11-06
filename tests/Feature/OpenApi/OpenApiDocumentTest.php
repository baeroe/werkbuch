<?php

use App\Domain\Automations\AutomationKey;
use App\Exceptions\Problem;
use App\OpenApi\JsonSchema;
use App\OpenApi\ProblemExceptionResponses;
use App\OpenApi\Schemas;
use Dedoc\Scramble\Infer;
use Dedoc\Scramble\OpenApiContext;
use Dedoc\Scramble\Scramble;
use Dedoc\Scramble\Support\Generator\Components as Registry;
use Dedoc\Scramble\Support\Generator\OpenApi;
use Dedoc\Scramble\Support\Generator\Reference;
use Dedoc\Scramble\Support\Generator\TypeTransformer;
use Dedoc\Scramble\Support\Type\ObjectType;
use Dedoc\Scramble\Support\Type\UnknownType;
use Illuminate\Auth\Access\AuthorizationException;
use Illuminate\Auth\AuthenticationException;
use Illuminate\Database\Eloquent\ModelNotFoundException;
use Illuminate\Routing\Route;
use Illuminate\Support\Facades\Route as Router;
use Illuminate\Validation\ValidationException;
use Tests\Support\OpenApi\Contract;
use Tests\Support\OpenApi\Document;

it('documents every route under api/v1 and nothing else', function () {
    $routes = [];

    foreach (Router::getRoutes()->getRoutes() as $route) {
        if (! Document::documents($route)) {
            continue;
        }

        foreach (array_diff($route->methods(), ['HEAD']) as $method) {
            $routes[] = $method.' '.substr($route->uri(), strlen('api/v1'));
        }
    }

    sort($routes);
    $operations = array_keys(Document::operations());
    sort($operations);

    expect($routes)->not->toBeEmpty()
        ->and(array_values(array_diff($routes, $operations)))->toBe([])
        ->and(array_values(array_diff($operations, $routes)))->toBe([])
        ->and(Document::operation('GET', '/work-items/{item}'))->toBeArray()
        ->and(Document::operation('get', 'work-items/{item}'))->toBe(Document::operation('GET', '/work-items/{item}'))
        ->and(Document::operation('GET', '/no-such-route'))->toBeNull();
});

it('keeps routes a test registers under api/v1/_t out of the contract', function () {
    Router::middleware('api')->prefix('api/v1')->get('_t/probe', fn () => ['ok' => true]);
    $probe = collect(Router::getRoutes()->getRoutes())->first(fn (Route $route) => $route->uri() === 'api/v1/_t/probe');

    expect($probe)->not->toBeNull()
        ->and(Document::documents($probe))->toBeFalse()
        ->and((Scramble::getGeneratorConfig(Scramble::DEFAULT_API)->routes())($probe))->toBeFalse()
        ->and(array_keys(Document::operations()))->not->toContain('GET /_t/probe');
});

it('generates without an analysis error', function () {
    expect(Scramble::shouldThrowOnError())->toBeTrue();

    // warnings (a resource whose model Scramble cannot infer, JR001) are the business of the tasks that describe the
    // areas; an error is a route Scramble failed to analyse
    $errors = array_values(array_filter(Document::diagnostics(), fn (string $d) => ! str_starts_with($d, 'Warning ')));

    expect(Document::diagnostics())->not->toContain('')
        ->and($errors)->toBe([]);
});

it('generates the document in under 30 s and under 512 MB', function () {
    $stats = Document::stats();

    fwrite(STDERR, sprintf("\nOpenAPI document generated in %.1f s, %d MB at its peak\n", $stats['seconds'], $stats['bytes'] / 1048576));

    expect($stats['seconds'])->toBeLessThan(30.0)
        ->and($stats['bytes'])->toBeLessThan(512 * 1048576);
});

it('describes the problem shape', function () {
    $components = Document::get()['components'];
    $problem = $components['schemas']['Problem'];

    expect($problem['type'])->toBe('object')
        ->and($problem['required'])->toBe(['type', 'title', 'status', 'reason'])
        ->and(array_keys($problem['properties']))->toBe(['type', 'title', 'status', 'detail', 'reason', 'errors', 'current', 'states', 'projects', 'issues'])
        ->and($problem['properties']['status']['type'])->toBe('integer')
        ->and($problem['properties']['errors']['type'])->toBe('object')
        ->and($problem['properties']['errors']['additionalProperties'])->toBe(['type' => 'array', 'items' => ['type' => 'string']])
        // the extensions of a problem (`current`, `states`, `projects`, …) stand next to its fields
        ->and($problem['x-werkbuch-open'])->toBeTrue()
        ->and($problem['properties']['type']['pattern'])->toBe('^urn:werkbuch:problem:[a-z0-9_]+$');

    foreach ($components['responses'] as $name => $response) {
        expect($name)->toMatch('/^Problem\d{3}$/')
            ->and($response['content'])->toBe(['application/problem+json' => ['schema' => ['$ref' => '#/components/schemas/Problem']]]);
    }

    expect($components['responses']['Problem429']['headers']['Retry-After']['schema']['type'])->toBe('integer')
        ->and($components['schemas']['RichTextDocument']['properties']['type'])->toBe(['type' => 'string', 'const' => 'doc'])
        ->and($components['schemas']['RichTextDocument']['x-werkbuch-open'])->toBeTrue()
        ->and(array_keys($components['schemas']['ListLinks']['properties']))->toBe(['first', 'last', 'prev', 'next'])
        ->and(array_keys($components['schemas']['ListMeta']['properties']))->toBe(['path', 'per_page', 'next_cursor', 'prev_cursor', 'total'])
        // a plain schema serializes as it was given, in 3.1 and 3.2
        ->and((new JsonSchema(Schemas::problem()))->serializeAs31())->toBe(Schemas::problem())
        ->and((new JsonSchema(Schemas::problem()))->serializeAs32())->toBe(Schemas::problem());
});

it('documents the errors of every operation', function () {
    foreach (Document::operations() as $key => $operation) {
        [$method, $path] = explode(' ', $key, 2);
        $codes = array_map('intval', array_keys($operation['responses']));
        $errors = [401, 403, 404, 422, 429, 500, 503];
        if ($method !== 'GET') {
            // a body can be too large; the session of the interface sends a CSRF token
            $errors = [...$errors, 413, 419];
        }
        if ($operation['x-werkbuch-ability'] === 'write') {
            $errors[] = 409;
        }

        expect(array_values(array_filter($codes, fn (int $code) => $code >= 400)))->toEqualCanonicalizing($errors, $key);

        foreach ($operation['responses'] as $code => $response) {
            if ((int) $code >= 400) {
                // never Laravel's `{message}` as application/json (K1)
                expect($response)->toBe(['$ref' => '#/components/responses/Problem'.$code], "{$key} {$code}");
            } elseif ((int) $code < 300) {
                expect(array_keys($response['headers'] ?? []))->toBe(['X-RateLimit-Limit', 'X-RateLimit-Remaining'], "{$key} {$code}");
            }
        }

        // a read by a former key moves to the current one (RedirectFormerItemKey)
        if ($method === 'GET' && str_contains($path, '{item}')) {
            expect($operation['responses']['301']['headers']['Location']['schema']['type'] ?? null)->toBe('string', $key);
        } else {
            expect(array_key_exists('301', $operation['responses']))->toBeFalse($key);
        }
    }
});

it('says what an item path takes', function () {
    $parameter = fn (string $method, string $path, string $name) => collect(Document::operation($method, $path)['parameters'])
        ->first(fn (array $p) => $p['in'] === 'path' && $p['name'] === $name);

    $item = $parameter('GET', '/work-items/{item}', 'item');
    $project = $parameter('GET', '/projects/{project}', 'project');

    expect($item['description'])->toContain('key')->toContain('ULID')->toContain('301')
        ->and($item['schema'])->toBe(['type' => 'string'])
        ->and($project['description'])->toContain('identifier')->toContain('ULID')
        ->and($project['schema'])->toBe(['type' => 'string']);
});

it('gives a pattern only to ULID parameters', function () {
    $ulid = '^[0-7][0-9A-HJKMNP-TV-Za-hjkmnp-tv-z]{25}$';
    $seen = [];

    foreach (Document::operations() as $key => $operation) {
        foreach ($operation['parameters'] ?? [] as $parameter) {
            if ($parameter['in'] !== 'path') {
                continue;
            }
            $seen[$parameter['name']] = true;

            expect($parameter['required'])->toBeTrue()->and($parameter['description'])->not->toBe('');

            match ($parameter['name']) {
                'item', 'project' => expect($parameter['schema'])->toBe(['type' => 'string'], $key),
                'key' => expect($parameter['schema'])->toBe(['type' => 'string', 'enum' => array_column(AutomationKey::cases(), 'value')], $key),
                default => expect($parameter['schema'])->toBe(['type' => 'string', 'pattern' => $ulid], "{$key} {$parameter['name']}")
                    ->and($parameter['description'])->toContain('ULID'),
            };
        }
    }

    expect($seen)->toHaveKeys(['item', 'project', 'key', 'label', 'pageVersion']);
});

it('gives every operation a unique operation id', function () {
    $ids = array_map(fn (array $operation) => $operation['operationId'] ?? null, Document::operations());

    expect($ids)->not->toContain(null)
        ->and(array_unique($ids))->toHaveCount(count($ids))
        ->and(array_filter($ids, fn (string $id) => str_contains(strtolower($id), 'head')))->toBe([])
        ->and($ids['GET /work-items/{item}'])->toBe('workItems.show');
});

it('keeps Laravel error shapes out of the components', function () {
    expect(array_keys(Document::get()['components']['responses']))->each->toStartWith('Problem');
});

it('turns the exceptions Scramble infers into problems, not into Laravel shapes', function () {
    $openApi = OpenApi::make()->setComponents($registry = new Registry);
    $transformer = app(TypeTransformer::class, ['context' => new OpenApiContext($openApi, Scramble::getGeneratorConfig(Scramble::DEFAULT_API))]);

    foreach ([AuthenticationException::class => 401, AuthorizationException::class => 403, ModelNotFoundException::class => 404, ValidationException::class => 422] as $class => $status) {
        $response = $transformer->toResponse(new ObjectType($class));

        expect($response)->toBeInstanceOf(Reference::class)
            ->and($response->getUri())->toBe('#/components/responses/Problem'.$status)
            ->and($response->resolve()->code)->toBe($status)
            ->and(array_keys($response->resolve()->content))->toBe(['application/problem+json']);
    }

    // what it cannot read it leaves to Scramble's own extensions; ProblemResponses replaces their answers by status
    $extension = new ProblemExceptionResponses(app(Infer::class), $transformer, $registry);

    expect($extension->shouldHandle(new ObjectType(RuntimeException::class)))->toBeFalse()
        ->and($extension->shouldHandle(new UnknownType))->toBeFalse()
        ->and($extension->toResponse(new ObjectType(RuntimeException::class)))->toBeNull()
        ->and($extension->reference(new ObjectType(RuntimeException::class)))->toBeNull()
        ->and(array_keys($registry->responses))->toBe(['Problem401', 'Problem403', 'Problem404', 'Problem422']);
});

it('names only tags of the document as strict', function () {
    // a strict tag the document does not have makes no operation strict (Scramble names a tag after its controller)
    $tags = collect(Document::operations())->flatMap(fn (array $operation) => $operation['tags'] ?? [])->unique()->values()->all();

    expect($tags)->toContain('Labels', 'WorkItems')
        ->and(array_values(array_diff(Contract::STRICT_TAGS, $tags)))->toBe([]);
});

it('has no empty schema', function () {
    // `{}` or an object without keys lets every answer through (Review Focus 1); a place with free keys says so with
    // `x-werkbuch-open`, which also opens everything under it
    $schema = ['type' => 'object', 'properties' => [
        'any' => [],
        'bare' => ['type' => 'object'],
        'map' => ['type' => 'object', 'additionalProperties' => ['type' => 'string']],
        'open' => ['type' => 'object', 'x-werkbuch-open' => true, 'properties' => ['nodes' => ['type' => 'array', 'items' => ['type' => 'object']]]],
        'list' => ['type' => 'array', 'items' => ['anyOf' => [['$ref' => '#/components/schemas/Thing'], ['type' => 'null']]]],
        'again' => ['$ref' => '#/components/schemas/Thing'],
        // Scramble gives an empty schema as an object, not as an array (T3-I1)
        'blank' => new stdClass,
    ]];
    $probe = [
        'openapi' => '3.1.0',
        'paths' => [
            '/things' => ['post' => [
                'tags' => ['Things'],
                'requestBody' => ['content' => ['application/json' => ['schema' => ['type' => ['object', 'null']]]]],
                'responses' => ['200' => ['content' => ['application/json' => ['schema' => $schema]]], '422' => ['$ref' => '#/components/responses/Problem422']],
            ]],
            '/loose' => ['get' => ['tags' => ['Loose'], 'responses' => ['200' => ['content' => ['application/json' => ['schema' => []]]]]]],
        ],
        'components' => [
            'schemas' => ['Thing' => ['type' => 'object', 'properties' => ['meta' => ['type' => 'object', 'additionalProperties' => []]]]],
            'responses' => ['Problem422' => ['content' => ['application/problem+json' => ['schema' => ['type' => 'object']]]]],
        ],
    ];
    $at = '#/paths/~1things/post/responses/200/content/application~1json/schema/properties';

    expect(Contract::emptySchemas($probe, ['Things']))->toBe([
        "{$at}/any: empty schema",
        "{$at}/bare: object without properties",
        '#/components/schemas/Thing/properties/meta/additionalProperties: empty schema',
        "{$at}/blank: empty schema",
        '#/components/responses/Problem422/content/application~1problem+json/schema: object without properties',
        '#/paths/~1things/post/requestBody/content/application~1json/schema: object without properties',
    ])
        ->and(Contract::emptySchemas($probe, null))->toContain('#/paths/~1loose/get/responses/200/content/application~1json/schema: empty schema')
        // the areas become strict task by task (Tasks 8–12); the strict ones have no empty schema
        ->and(Contract::emptySchemas(Document::get(), Contract::STRICT_TAGS))->toBe([]);
});

it('documents every reason the server can answer', function () {
    $translations = json_decode((string) file_get_contents(base_path('lang/en.json')), true, flags: JSON_THROW_ON_ERROR);
    $reasons = [];
    foreach (array_keys($translations) as $key) {
        if (str_starts_with($key, 'problem.reason.')) {
            $reasons[] = substr($key, strlen('problem.reason.'));
        }
    }

    $schema = Document::get()['components']['schemas']['Problem']['properties']['reason'];

    expect($reasons)->not->toBeEmpty()
        ->and($schema['enum'])->toBe($reasons)
        ->and($schema['description'])->toContain('additively')
        // the reasons a Problem can carry are exactly the translated ones
        ->and($reasons)->toEqualCanonicalizing(Problem::REASONS)
        ->and(Schemas::problemReasons())->toBe($reasons);
});

it('documents every extension of a problem', function () {
    $found = [];
    $files = new RecursiveIteratorIterator(new RecursiveDirectoryIterator(base_path('app'), FilesystemIterator::SKIP_DOTS));

    foreach ($files as $file) {
        $path = str_replace(base_path('app').'/', '', $file->getPathname());
        if ($file->getExtension() !== 'php' || str_starts_with($path, 'OpenApi/') || $path === 'Exceptions/Problem.php') {
            continue;
        }

        $code = (string) file_get_contents($file->getPathname());
        // Problem::conflict($reason, [extensions, ...]) and Problem::unprocessable($reason, $errors, [extensions, ...])
        preg_match_all('/Problem::conflict\(\s*[\'"][a-z_]+[\'"],\s*\[\s*[\'"](\w+)[\'"]\s*=>/s', $code, $conflicts);
        preg_match_all('/Problem::unprocessable\(\s*[\'"][a-z_]+[\'"],\s*\$\w+,\s*\[\s*[\'"](\w+)[\'"]\s*=>/s', $code, $unprocessable);
        foreach ([...$conflicts[1], ...$unprocessable[1]] as $key) {
            $found[$key] = $path;
        }
    }

    $properties = Document::get()['components']['schemas']['Problem']['properties'];

    // the scan reads the three extensions of this phase; a new one is found here before it is undocumented
    expect(array_keys($found))->toEqualCanonicalizing(['current', 'projects', 'states', 'issues']);
    foreach ($found as $key => $path) {
        expect($properties)->toHaveKey($key);
        expect($properties[$key]['description'])->not->toBeEmpty();
    }
});
