<?php

use Tests\Support\OpenApi\Document;

/*
 * What the document says a token needs (spec 6.1): the ability per operation and whether only the session of the
 * interface may call it, held against the route matrix (tests/Feature/Api/routes.php), which RouteMatrixTest checks
 * against the server. Several rows may share a route; they agree on the route, not on the body.
 */

/**
 * Per route of the matrix (`"<METHOD> <path without /api/v1>"`): the ability it needs and whether it is session only.
 *
 * @return array<string, array{ability: string, session: bool}>
 */
$matrix = function (): array {
    /** @var array<string, array{0: string, 1: string, session?: bool|'action', ability?: 'read'|'write'}> $rows */
    $rows = require base_path('tests/Feature/Api/routes.php');
    $routes = [];

    foreach ($rows as $row) {
        [$method, $uri] = $row;
        $key = $method.' '.substr($uri, strlen('/api/v1'));
        $routes[$key] = [
            'ability' => $row['ability'] ?? (in_array($method, ['GET', 'HEAD'], true) ? 'read' : 'write'),
            'session' => ($routes[$key]['session'] ?? false) || ($row['session'] ?? false) === true,
        ];
    }

    return $routes;
};

it('says the ability of every route like the route matrix', function () use ($matrix) {
    $routes = $matrix();

    expect(array_keys($routes))->toEqualCanonicalizing(array_keys(Document::operations()));

    foreach ($routes as $key => $expected) {
        [$method, $path] = explode(' ', $key, 2);
        $operation = Document::operation($method, $path);

        expect($operation['x-werkbuch-ability'] ?? null)->toBe($expected['ability'], $key);

        if ($expected['session']) {
            expect($operation['x-werkbuch-session-only'] ?? null)->toBeTrue($key);
        } else {
            expect(array_key_exists('x-werkbuch-session-only', $operation))->toBeFalse($key);
        }
    }

    // the reads through a body say so (P15), whatever their method
    expect(Document::operation('POST', '/work-items/query')['x-werkbuch-ability'])->toBe('read')
        ->and(Document::operation('POST', '/work-items/bulk')['x-werkbuch-ability'])->toBe('write');
});

it('offers only the session for session routes', function () use ($matrix) {
    $sessionOnly = ['POST /tokens', 'PUT /me/password', 'GET /me/two-factor', 'POST /me/two-factor',
        'POST /me/two-factor/confirm', 'DELETE /me/two-factor', 'POST /me/two-factor/recovery-codes'];

    expect(array_keys(array_filter($matrix(), fn (array $route) => $route['session'])))->toEqualCanonicalizing($sessionOnly);

    foreach (Document::operations() as $key => $operation) {
        $expected = in_array($key, $sessionOnly, true) ? [['session' => []]] : [['token' => []], ['session' => []]];

        expect($operation['security'] ?? null)->toBe($expected, $key);
    }
});

it('describes the token and the session as security schemes', function () {
    $schemes = Document::get()['components']['securitySchemes'] ?? [];

    expect(array_keys($schemes))->toEqualCanonicalizing(['token', 'session'])
        ->and($schemes['token']['type'])->toBe('http')
        ->and($schemes['token']['scheme'])->toBe('bearer')
        ->and($schemes['token']['bearerFormat'])->toBe('<id>|wb_<secret>')
        ->and($schemes['session']['type'])->toBe('apiKey')
        ->and($schemes['session']['in'])->toBe('cookie')
        ->and($schemes['session']['name'])->toBe(config('session.cookie'))
        ->and($schemes['session']['description'])->toContain('X-XSRF-TOKEN');
});

it('says in the text of an operation that the action itself wants the session (A55)', function () {
    /** @var array<int, array{0: string, 1: string, session?: bool|'action'}> $rows */
    $rows = require base_path('tests/Feature/Api/routes.php');

    foreach (array_filter($rows, fn ($row) => ($row['session'] ?? false) === 'action') as $row) {
        $operation = Document::operation($row[0], substr($row[1], strlen('/api/v1')));

        // the route takes a token, so the document cannot mark it session only; the text says which input does not
        expect($operation)->not->toHaveKey('x-werkbuch-session-only')
            ->and($operation['description'] ?? '')->toContain('session');
    }
});
