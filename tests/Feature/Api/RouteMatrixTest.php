<?php

use App\Models\User;
use Illuminate\Routing\Route as RoutingRoute;
use Illuminate\Support\Facades\Route;

/*
 * Every REST route × every kind of token of an org admin (master plan Review Focus "Token-Fähigkeiten"). Allowed
 * means: neither 401 nor 403 nor a server error (the request itself may still be invalid, e.g. 422); reading needs
 * `read`, everything else `write`. Without a token it is 401. The rows: routes.php; a guard keeps them in sync with the
 * routes.
 */

const ROUTE_MATRIX_TOKENS = ['none' => [], 'read' => ['read'], 'write' => ['write'], 'read+write' => ['read', 'write']];

/**
 * @return array<string, array{0: string, 1: string, session?: bool}>
 */
function routeMatrixRows(): array
{
    return require __DIR__.'/routes.php';
}

it('opens each route only to tokens with the right ability', function (string $method, string $uri, bool $session, string $token) {
    $admin = User::factory()->admin()->create();
    $client = $token === 'none' ? $this : $this->withToken(apiToken($admin, ROUTE_MATRIX_TOKENS[$token]));

    $response = $client->json($method, $uri);
    $context = "{$method} {$uri} with {$token}: {$response->getContent()}";
    $needed = in_array($method, ['GET', 'HEAD'], true) ? 'read' : 'write';

    if ($token === 'none') {
        $response->assertUnauthorized()->assertHeader('Content-Type', 'application/problem+json');
    } elseif ($session) {
        $response->assertForbidden()->assertJsonPath('reason', 'session_required');
    } elseif (in_array($needed, ROUTE_MATRIX_TOKENS[$token], true)) {
        expect($response->getStatusCode())->not->toBeIn([401, 403], $context)->toBeLessThan(500, $context);
    } else {
        $response->assertForbidden()->assertHeader('Content-Type', 'application/problem+json')->assertJsonPath('reason', 'forbidden');
    }
})->with(collect(routeMatrixRows())->map(fn (array $row) => [$row[0], $row[1], $row['session'] ?? false])->all())
    ->with(array_keys(ROUTE_MATRIX_TOKENS));

it('has a row for every REST route (new routes need one)', function () {
    $covered = collect(routeMatrixRows())->map(fn (array $row) => $row[0].' '.ltrim($row[1], '/'))->sort()->values()->all();

    $routes = collect(Route::getRoutes()->getRoutes())
        ->filter(fn (RoutingRoute $route) => str_starts_with($route->uri(), 'api/v1/'))
        ->flatMap(fn (RoutingRoute $route) => array_map(fn (string $method) => "{$method} {$route->uri()}", array_diff($route->methods(), ['HEAD'])))
        ->sort()->values()->all();

    expect($covered)->toBe($routes);
});
