<?php

use App\Models\User;
use Illuminate\Http\Request;
use Illuminate\Routing\Route;
use Illuminate\Support\Facades\Route as Router;
use PHPUnit\Framework\AssertionFailedError;
use Symfony\Component\HttpFoundation\BinaryFileResponse;
use Symfony\Component\HttpFoundation\Response;
use Tests\Support\OpenApi\Contract;
use Tests\TestCase;

// The contract checks what the feature tests send and get under /api/v1 against the OpenAPI document (A385, K2, K3).
// These tests give it a small document of their own; afterEach forgets what they recorded on purpose.

afterEach(fn () => Contract::reset());

$object = fn (array $properties, array $more = []) => ['type' => 'object', 'properties' => $properties, 'required' => array_keys($properties)] + $more;

$json = fn (array|string $schema) => ['content' => ['application/json' => ['schema' => is_string($schema) ? ['$ref' => $schema] : $schema]]];

$document = fn (array $paths, array $schemas = [], array $responses = []) => [
    'openapi' => '3.1.0',
    'paths' => $paths,
    'components' => ['schemas' => $schemas, 'responses' => $responses],
];

/**
 * One exchange as the app answered it: the route `api/v1/<uri>`, the request body (an array goes as JSON) and the
 * answer (an array goes as JSON with `$type`).
 */
$exchange = function (string $method, string $uri, int $status, mixed $body = null, mixed $sent = null, string $type = 'application/json', string $sentType = 'application/json') {
    $route = new Route([$method], 'api/v1/'.$uri, fn () => null);
    $request = Request::create('/api/v1/'.$uri, $method, [], [], [], $sent === null ? [] : ['CONTENT_TYPE' => $sentType], match (true) {
        $sent === null => '',
        is_string($sent) => $sent,
        default => json_encode($sent),
    });
    $request->setRouteResolver(fn () => $route);
    $response = new Response($body === null ? '' : (is_string($body) ? $body : json_encode($body)), $status, $body === null ? [] : ['Content-Type' => $type]);

    Contract::record($request, $response);
};

it('reports an undocumented status', function () use ($document, $json, $object, $exchange) {
    Contract::using($document(['/things' => ['get' => ['tags' => ['Things'], 'responses' => ['200' => $json($object(['id' => ['type' => 'string']]))]]]]));

    $exchange('GET', 'things', 200, ['id' => 'a']);
    $exchange('GET', 'things', 418, ['id' => 'a']);

    expect(Contract::violations())->toBe(['GET /things 418: status is not documented']);
});

it('reports a key the schema does not name, also in nested objects and list items', function () use ($document, $json, $object, $exchange) {
    $thing = $object(['id' => ['type' => 'string'], 'owner' => $object(['id' => ['type' => 'string']])]);
    Contract::using($document(['/things' => ['get' => ['responses' => ['200' => $json($object(['data' => ['type' => 'array', 'items' => $thing]]))]]]]));

    $exchange('GET', 'things', 200, ['data' => [['id' => 'a', 'owner' => ['id' => 'u']]]]);
    expect(Contract::violations())->toBe([]);

    $exchange('GET', 'things', 200, ['data' => [['id' => 'a', 'owner' => ['id' => 'u'], 'secret' => 1]]]);
    $exchange('GET', 'things', 200, ['data' => [['id' => 'a', 'owner' => ['id' => 'u', 'email' => 'x@example.com']]]]);
    $exchange('GET', 'things', 200, ['data' => [], 'meta' => []]);

    expect(Contract::violations())->toHaveCount(3)
        ->sequence(
            fn ($line) => $line->toStartWith('GET /things 200: /data/0: ')->toContain('secret'),
            fn ($line) => $line->toStartWith('GET /things 200: /data/0/owner: ')->toContain('email'),
            fn ($line) => $line->toBe('GET /things 200: /: Unevaluated object properties not allowed: meta'),
        );
});

it('accepts a key under an open schema', function () use ($document, $json, $object, $exchange) {
    Contract::using($document(
        ['/things' => ['get' => ['responses' => ['200' => $json($object([
            'doc' => ['$ref' => '#/components/schemas/Doc'],
            'values' => ['type' => 'object', 'x-werkbuch-open' => true],
        ]))]]]],
        ['Doc' => ['type' => 'object', 'properties' => ['type' => ['const' => 'doc'], 'content' => ['type' => 'array', 'items' => ['type' => 'object']]], 'x-werkbuch-open' => true]],
    ));

    // the open schema keeps its own keys and the objects under it open
    $exchange('GET', 'things', 200, ['doc' => ['type' => 'doc', 'content' => [['type' => 'paragraph', 'attrs' => ['x' => 1]]], 'more' => true], 'values' => ['effort' => 3]]);

    expect(Contract::violations())->toBe([]);
});

it('reports a wrong type of a nullable field', function () use ($document, $json, $object, $exchange) {
    Contract::using($document(['/things' => ['get' => ['responses' => ['200' => $json($object([
        'name' => ['type' => 'string'],
        'due' => ['type' => ['string', 'null']],
    ]))]]]]));

    $exchange('GET', 'things', 200, ['name' => 'a', 'due' => null]);
    $exchange('GET', 'things', 200, ['name' => null, 'due' => null]);
    $exchange('GET', 'things', 200, ['name' => 'a', 'due' => 3]);

    expect(Contract::violations())->toHaveCount(2)
        ->sequence(
            fn ($line) => $line->toStartWith('GET /things 200: /name: '),
            fn ($line) => $line->toStartWith('GET /things 200: /due: '),
        );
});

it('reports a missing required key', function () use ($document, $json, $object, $exchange) {
    Contract::using($document(['/things' => ['get' => ['responses' => ['200' => $json($object(['id' => ['type' => 'string']]))]]]]));

    $exchange('GET', 'things', 200, ['nope' => 'a']);

    expect(Contract::violations())->toHaveCount(1)
        ->and(Contract::violations()[0])->toStartWith('GET /things 200: /: ')->toContain('id');
});

it('checks the request body only for a success', function () use ($document, $json, $object, $exchange) {
    Contract::using($document(
        ['/things' => ['post' => [
            'requestBody' => $json($object(['name' => ['type' => 'string']])),
            'responses' => ['201' => $json($object(['id' => ['type' => 'string']])), '422' => ['$ref' => '#/components/responses/Problem422']],
        ]]],
        ['Problem' => $object(['reason' => ['type' => 'string']], ['x-werkbuch-open' => true])],
        ['Problem422' => ['content' => ['application/problem+json' => ['schema' => ['$ref' => '#/components/schemas/Problem']]]]],
    ));

    // the server refused it: what the test sent wrong is the point of the test
    $exchange('POST', 'things', 422, ['reason' => 'validation_failed', 'errors' => ['name' => ['…']]], ['name' => 1, 'nope' => true], 'application/problem+json');
    expect(Contract::violations())->toBe([]);

    $exchange('POST', 'things', 201, ['id' => 'a'], ['name' => 'a', 'nope' => true]);
    $exchange('POST', 'things', 201, ['id' => 'a'], ['name' => 'a']);

    expect(Contract::violations())->toHaveCount(1)
        ->and(Contract::violations()[0])->toStartWith('POST /things 201: request /: ')->toContain('nope');
});

it('reports a request body where the operation takes none', function () use ($document, $exchange) {
    Contract::using($document(['/things/{thing}' => ['delete' => ['responses' => ['204' => ['description' => 'Deleted.']]]]]));

    // getJson and deleteJson send `[]` when they have nothing: that is no body
    $exchange('DELETE', 'things/{thing}', 204, null, []);
    expect(Contract::violations())->toBe([]);

    $exchange('DELETE', 'things/{thing}', 204, null, ['emoji' => 'x']);

    expect(Contract::violations())->toBe(['DELETE /things/{thing} 204: request: the operation takes no body']);
});

it('skips a multipart body and checks answers without JSON only for their status', function () use ($document, $json, $object, $exchange) {
    Contract::using($document(['/files' => ['post' => [
        'requestBody' => ['content' => ['multipart/form-data' => ['schema' => $object(['file' => ['type' => 'string']])]]],
        'responses' => ['201' => $json($object(['id' => ['type' => 'string']])), '204' => ['description' => 'Nothing.']],
    ], 'get' => ['responses' => ['200' => ['content' => ['application/octet-stream' => ['schema' => ['type' => 'string']]]]]]]]));

    $exchange('POST', 'files', 201, ['id' => 'a'], "--x\r\nContent-Disposition: form-data; name=\"file\"\r\n\r\nabc\r\n--x--", sentType: 'multipart/form-data; boundary=x');
    $exchange('POST', 'files', 204);
    $exchange('GET', 'files', 200, 'binary bytes', type: 'application/octet-stream');

    $route = new Route(['GET'], 'api/v1/files', fn () => null);
    $request = Request::create('/api/v1/files');
    $request->setRouteResolver(fn () => $route);
    Contract::record($request, new BinaryFileResponse(__FILE__));

    expect(Contract::violations())->toBe([]);

    $exchange('GET', 'files', 404, 'gone', type: 'text/plain');

    expect(Contract::violations())->toBe(['GET /files 404: status is not documented']);
});

it('reports a JSON answer of a media type the status does not document', function () use ($document, $json, $object, $exchange) {
    Contract::using($document(['/things' => ['get' => ['responses' => ['200' => $json($object(['id' => ['type' => 'string']]))]]]]));

    $exchange('GET', 'things', 200, ['message' => 'x'], type: 'application/problem+json');
    $exchange('GET', 'things', 200, '{not json', type: 'application/json');

    expect(Contract::violations())->toBe([
        'GET /things 200: media type application/problem+json is not documented',
        'GET /things 200: the body is no JSON',
    ]);
});

it('accepts an allOf with keys of both branches', function () use ($document, $json, $object, $exchange) {
    Contract::using($document(
        ['/me' => ['get' => ['responses' => ['200' => $json($object(['data' => ['allOf' => [
            ['$ref' => '#/components/schemas/User'],
            $object(['permissions' => ['type' => 'array', 'items' => ['type' => 'string']]]),
        ]]]))]]]],
        ['User' => $object(['id' => ['type' => 'string'], 'name' => ['type' => 'string']])],
    ));

    $exchange('GET', 'me', 200, ['data' => ['id' => 'u', 'name' => 'Mara', 'permissions' => ['item.edit']]]);
    expect(Contract::violations())->toBe([]);

    // the outermost object stays closed
    $exchange('GET', 'me', 200, ['data' => ['id' => 'u', 'name' => 'Mara', 'permissions' => [], 'token' => 'x']]);

    expect(Contract::violations())->toHaveCount(1)
        ->and(Contract::violations()[0])->toStartWith('GET /me 200: /data: ')->toContain('token');
});

it('closes a nullable reference and an object referenced from a property', function () use ($document, $json, $object, $exchange) {
    Contract::using($document(
        ['/things' => ['get' => ['responses' => ['200' => $json($object([
            'parent' => ['anyOf' => [['$ref' => '#/components/schemas/Ref'], ['type' => 'null']]],
            'owner' => ['$ref' => '#/components/schemas/Ref'],
        ]))]]]],
        ['Ref' => $object(['id' => ['type' => 'string']])],
    ));

    $exchange('GET', 'things', 200, ['parent' => null, 'owner' => ['id' => 'u']]);
    $exchange('GET', 'things', 200, ['parent' => ['id' => 'p'], 'owner' => ['id' => 'u']]);
    expect(Contract::violations())->toBe([]);

    $exchange('GET', 'things', 200, ['parent' => ['id' => 'p', 'key' => 'WEB-1'], 'owner' => ['id' => 'u', 'email' => 'x']]);

    expect(Contract::violations())->toHaveCount(2)
        ->sequence(
            fn ($line) => $line->toStartWith('GET /things 200: /parent: ')->toContain('key'),
            fn ($line) => $line->toStartWith('GET /things 200: /owner: ')->toContain('email'),
        );
});

it('accepts the own answer sent back to a PUT', function () use ($document, $json, $object, $exchange) {
    $label = $object(['id' => ['type' => 'string'], 'name' => ['type' => 'string'], 'created_at' => ['type' => 'string']]);
    Contract::using($document(['/labels/{label}' => ['put' => [
        // a replacing PUT names the keys of its answer as sent back and ignored (A75, K2) and keeps the rest open
        'requestBody' => $json([
            'type' => 'object',
            'properties' => [
                'name' => ['type' => 'string'],
                'id' => ['type' => 'string', 'readOnly' => true, 'description' => 'Sent back, ignored.'],
                'created_at' => ['type' => 'string', 'readOnly' => true, 'description' => 'Sent back, ignored.'],
            ],
            'required' => ['name'],
            'x-werkbuch-open' => true,
        ]),
        'responses' => ['200' => $json($object(['data' => $label]))],
    ]]]));

    $answer = ['id' => 'l', 'name' => 'UX', 'created_at' => '2026-11-06T10:00:00.000000Z'];
    $exchange('PUT', 'labels/{label}', 200, ['data' => $answer], $answer + ['updated_at' => 'x']);

    expect(Contract::violations())->toBe([]);
});

it('takes a response and a request body by reference', function () use ($document, $json, $object, $exchange) {
    Contract::using([
        ...$document(['/things' => ['post' => [
            'requestBody' => ['$ref' => '#/components/requestBodies/Thing'],
            'responses' => ['201' => ['$ref' => '#/components/responses/Thing'], '2XX' => ['description' => 'Any other success.']],
        ]]]),
        'components' => [
            'schemas' => ['Thing' => $object(['id' => ['type' => 'string']])],
            'responses' => ['Thing' => $json('#/components/schemas/Thing')],
            'requestBodies' => ['Thing' => $json($object(['name' => ['type' => 'string']]))],
        ],
    ]);

    $exchange('POST', 'things', 201, ['id' => 'a'], ['name' => 'a']);
    $exchange('POST', 'things', 202, null, ['name' => 'a']);
    expect(Contract::violations())->toBe([]);

    $exchange('POST', 'things', 201, ['id' => 'a', 'x' => 1], ['name' => 'a', 'y' => 1]);

    expect(Contract::violations())->toHaveCount(2)
        ->sequence(
            fn ($line) => $line->toStartWith('POST /things 201: /: ')->toContain('x'),
            fn ($line) => $line->toStartWith('POST /things 201: request /: ')->toContain('y'),
        );
});

it('reports an operation the document does not have', function () use ($document, $exchange) {
    Contract::using($document([]));

    $exchange('PATCH', 'nowhere', 200, ['ok' => true]);

    expect(Contract::violations())->toBe(['PATCH /nowhere 200: the operation is not documented']);
});

it('counts only the operations of the strict tags', function () use ($document, $json, $object, $exchange) {
    $op = fn (string $tag) => ['get' => ['tags' => [$tag], 'responses' => ['200' => $json($object(['id' => ['type' => 'string']]))]]];
    Contract::using($document(['/strict' => $op('Strict'), '/loose' => $op('Loose')]), ['Strict']);

    $exchange('GET', 'strict', 200, ['id' => 'a', 'x' => 1]);
    $exchange('GET', 'loose', 200, ['id' => 'a', 'x' => 1]);
    $exchange('GET', 'loose', 418);

    expect(Contract::violations())->toHaveCount(1)
        ->and(Contract::violations()[0])->toStartWith('GET /strict 200: ');
});

it('starts with no strict tag on the real document', function () {
    expect(Contract::STRICT_TAGS)->toBe([]);
});

it('lets a test switch it off with a reason', function () use ($document, $exchange) {
    Contract::using($document([]));
    Contract::off('this test sends what no client may send');

    $exchange('GET', 'nowhere', 418, ['x' => 1]);

    expect(Contract::violations())->toBe([])
        ->and(fn () => Contract::off(' '))->toThrow(InvalidArgumentException::class, 'reason');
});

it('fails with the list of its violations and forgets them', function () use ($document, $exchange) {
    Contract::using($document([]));
    $exchange('GET', 'nowhere', 200);
    $exchange('GET', 'elsewhere', 200);

    expect(fn () => Contract::assertClean())->toThrow(
        AssertionFailedError::class,
        "The answers break the OpenAPI document:\nGET /nowhere 200: the operation is not documented\nGET /elsewhere 200: the operation is not documented",
    );

    expect(Contract::violations())->toBe([]);
    Contract::assertClean();
});

it('fails the test whose answers break the document when the test ends', function () use ($document, $exchange) {
    Contract::using($document([]));
    $exchange('GET', 'nowhere', 200);

    // the end of this test, run early (T3-M5): `TestCase::tearDown` itself, past the afterEach of this file, which
    // forgets; Pest's own tearDown afterwards finds the contract clean and no app to tear down
    expect(fn () => (new ReflectionMethod(TestCase::class, 'tearDown'))->invoke($this))->toThrow(AssertionFailedError::class, 'GET /nowhere 200: the operation is not documented');
});

it('records the api answers of a feature test, not test routes and not the web app', function () {
    Router::middleware('api')->prefix('api/v1')->get('_t/probe', fn () => ['ok' => true]);
    $this->actingAs(User::factory()->create());

    // the web app first: after a request over auth:sanctum, the web guard would need Auth::shouldUse('web')
    $this->get('/my-items')->assertOk();
    // an unknown path under api/v1 ends in the fallback of the web app
    $this->getJson('/api/v1/no-such-route')->assertNotFound();
    $this->getJson('/api/v1/labels')->assertOk();
    $this->getJson('/api/v1/work-items/WEB-404404')->assertNotFound();
    $this->getJson('/api/v1/_t/probe')->assertOk();

    expect(Contract::recorded())->toBe(['GET /labels 200', 'GET /work-items/{item} 404'])
        ->and(Contract::violations())->toBe([]);
});
