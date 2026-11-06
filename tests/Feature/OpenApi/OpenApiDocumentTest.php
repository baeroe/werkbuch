<?php

use Dedoc\Scramble\Scramble;
use Illuminate\Routing\Route;
use Illuminate\Support\Facades\Route as Router;
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
