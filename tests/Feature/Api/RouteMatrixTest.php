<?php

use Illuminate\Routing\Route as RoutingRoute;
use Illuminate\Support\Facades\Route;
use Tests\Feature\Access\MatrixWorld;

/*
 * Every REST route × every kind of token of an org admin (master plan Review Focus "Token-Fähigkeiten"). Allowed
 * means: neither 401 nor 403 nor 404 nor a server error (the request itself may still be invalid, e.g. 422); reading
 * needs `read`, everything else `write`. Without a token it is 401. The rows: routes.php; a guard keeps them in sync
 * with the routes.
 */

const ROUTE_MATRIX_TOKENS = ['none' => [], 'read' => ['read'], 'write' => ['write'], 'read+write' => ['read', 'write']];

/**
 * @return array<string, array{0: string, 1: string, params?: Closure(MatrixWorld): array<string, string>, session?: bool}>
 */
function routeMatrixRows(): array
{
    return require __DIR__.'/routes.php';
}

/**
 * The URI of a row with its placeholders filled in; a placeholder left over is a mistake in the row, never a 404 that
 * passes as "allowed".
 *
 * @param  array<string, string>  $params
 */
function routeMatrixUri(string $uri, array $params): string
{
    $filled = strtr($uri, collect($params)->mapWithKeys(fn (string $value, string $key) => ["{{$key}}" => $value])->all());

    if (str_contains($filled, '{')) {
        throw new RuntimeException("The route matrix row [{$uri}] has no value for a placeholder: {$filled}");
    }

    return $filled;
}

it('opens each route only to tokens with the right ability', function (array $row, string $token) {
    $w = MatrixWorld::build();
    [$method, $path] = $row;
    $uri = routeMatrixUri($path, isset($row['params']) ? ($row['params'])($w) : []);
    $client = $token === 'none' ? $this : $this->withToken(apiToken($w->account('org_admin'), ROUTE_MATRIX_TOKENS[$token]));

    $response = $client->json($method, $uri);
    $context = "{$method} {$uri} with {$token}: {$response->getContent()}";
    $needed = in_array($method, ['GET', 'HEAD'], true) ? 'read' : 'write';

    if ($token === 'none') {
        $response->assertUnauthorized()->assertHeader('Content-Type', 'application/problem+json');
    } elseif ($row['session'] ?? false) {
        $response->assertForbidden()->assertJsonPath('reason', 'session_required');
    } elseif (in_array($needed, ROUTE_MATRIX_TOKENS[$token], true)) {
        expect($response->getStatusCode())->not->toBeIn([401, 403, 404], $context)->toBeLessThan(500, $context);
    } else {
        $response->assertForbidden()->assertHeader('Content-Type', 'application/problem+json')->assertJsonPath('reason', 'forbidden');
    }
})->with(collect(routeMatrixRows())->map(fn (array $row) => [$row])->all())->with(array_keys(ROUTE_MATRIX_TOKENS));

it('fills the placeholders of a row and fails on one without a value', function () {
    expect(routeMatrixUri('/api/v1/users/{user}/role', ['user' => '01abc']))->toBe('/api/v1/users/01abc/role')
        ->and(routeMatrixUri('/api/v1/organization', []))->toBe('/api/v1/organization')
        ->and(fn () => routeMatrixUri('/api/v1/users/{user}', []))->toThrow(RuntimeException::class, '{user}')
        ->and(fn () => routeMatrixUri('/api/v1/users/{user}/tokens/{token}', ['user' => '01abc']))->toThrow(RuntimeException::class, '{token}');
});

it('has a row for every REST route (new routes need one)', function () {
    $covered = collect(routeMatrixRows())->map(fn (array $row) => $row[0].' '.ltrim($row[1], '/'))->sort()->values()->all();

    $routes = collect(Route::getRoutes()->getRoutes())
        ->filter(fn (RoutingRoute $route) => str_starts_with($route->uri(), 'api/v1/'))
        ->flatMap(fn (RoutingRoute $route) => array_map(fn (string $method) => "{$method} {$route->uri()}", array_diff($route->methods(), ['HEAD'])))
        ->sort()->values()->all();

    expect($covered)->toBe($routes);
});
