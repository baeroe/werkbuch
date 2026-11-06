<?php

namespace App\Providers;

use App\Http\Controllers\ApiDocsController;
use Dedoc\Scramble\Scramble;
use Illuminate\Cache\RateLimiting\Limit;
use Illuminate\Http\Request;
use Illuminate\Routing\Route;
use Illuminate\Routing\Router;
use Illuminate\Support\Facades\RateLimiter;
use Illuminate\Support\ServiceProvider;

/**
 * The OpenAPI document of `/api/v1` (Scramble) and its two public routes, `GET /api/openapi.json` and `GET /api/docs`.
 *
 * Names checked against dedoc/scramble 0.13.53 (vendor/dedoc/scramble/src):
 * - configuration: `Scramble::configure(): GeneratorConfig` with `routes(Closure)`, `expose(ui:, document:)` (strings or
 *   `Closure(Router, $action): Route`), `withOperationTransformers()`, `withDocumentTransformers()`,
 *   `Scramble::registerApi($name, $config)`, `Scramble::throwOnError()`; generation `Generator::generate(GeneratorConfig):
 *   GeneratorResult` (`spec()`, `diagnostics()`), cached by `CacheableGenerator` (reads `config('scramble.cache.store')`
 *   globally, written only by `scramble:cache`);
 * - extensions: `Dedoc\Scramble\Extensions\OperationExtension::handle(Operation, RouteInfo)`,
 *   `Dedoc\Scramble\Extensions\TypeToSchemaExtension`, `Dedoc\Scramble\Extensions\ExceptionToResponseExtension`,
 *   `Dedoc\Scramble\Infer\Extensions\StaticMethodReturnTypeExtension::shouldHandle(string)` and
 *   `getStaticMethodReturnType(StaticMethodCallEvent)`;
 * - attributes in `Dedoc\Scramble\Attributes`: `BodyParameter`, `QueryParameter`, `PathParameter`, `HeaderParameter`,
 *   `Response`, `Group` (with `weight`), `Endpoint`, `ExcludeRouteFromDocs`.
 *
 * Order (K4): Scramble copies `config('scramble')` into its generator configuration in its own `bootingPackage()`, which
 * runs before this provider boots, and that copy replaces the whole configuration; the middleware of the docs routes,
 * the dev tools and the cache are read from it. So everything Scramble copies is set here in `register()`; `boot()` only
 * chooses the routes and exposes the two documents. No config file is published.
 */
final class ApiServiceProvider extends ServiceProvider
{
    // the version of the API (not of the app: the document is public, the version of the instance is not, K5)
    public const API_VERSION = '1';

    // the checked in Stoplight Elements under public/vendor/stoplight-elements/<version> (K6)
    public const STOPLIGHT = '8.4.2';

    // the docs page runs only scripts and styles of its own origin; the document comes from the same origin (K6)
    public const DOCS_CSP = "default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; "
        ."connect-src 'self'; font-src 'self'; frame-ancestors 'none'";

    // generating the document is a full static analysis: few requests per IP (K5)
    public const DOCS_PER_MINUTE = 30;

    public function register(): void
    {
        config()->set([
            // paths in the document without the prefix (`/work-items/{item}`), the server carries it
            'scramble.api_path' => 'api/v1',
            'scramble.servers' => ['' => rtrim((string) config('app.url'), '/').'/api/v1'],
            // public, without the web group (no session, no cookie) and without Scramble's RestrictedDocsAccess (K4)
            'scramble.middleware' => ['throttle:api-docs'],
            // the cache is written by `scramble:cache` only; outside production it would serve a stale document (K3, K5)
            'scramble.cache.store' => $this->app->environment('production') ? config('scramble.cache.store') : null,
            // the dev tools show diagnostics with file paths and register a route of their own
            'scramble.dev_tools.enabled' => false,
            'scramble.ui.title' => 'werkbuch API',
            'scramble.info.version' => self::API_VERSION,
            'scramble.info.description' => 'werkbuch REST API v1. Authenticate with a token (`Authorization: Bearer <id>|wb_<secret>`, '
                .'created in the personal settings under “API & MCP”) or with the session of the web app. Errors are Problem '
                .'Details (RFC 9457, `application/problem+json`) with a `reason`. Lists are cursor-paginated (`cursor`, '
                .'`per_page` up to 100) and answer `{data, links, meta}`. The guide is the page “API” of the werkbuch '
                .'documentation (https://github.com/baeroe/werkbuch, `docs/en/api.md`).',
            'scramble.renderers.elements.view' => 'api-docs',
        ]);
    }

    public function boot(): void
    {
        // an analysis that fails throws in the tests instead of hiding in a description (K3)
        if ($this->app->runningUnitTests()) {
            Scramble::throwOnError();
        }

        Scramble::configure()
            // routes a test registers under api/v1/_t/ are no part of the API (K3)
            ->routes(fn (Route $route) => str_starts_with($route->uri(), 'api/v1/') && ! str_contains($route->uri(), '_t/'))
            ->expose(
                // the page loads the document itself (`/api/openapi.json`) and so generates nothing of its own
                ui: fn (Router $router) => $router->get('api/docs', ApiDocsController::class)->name('api.docs'),
                document: fn (Router $router, mixed $action) => $router->get('api/openapi.json', $action)->name('api.openapi'),
            );

        RateLimiter::for('api-docs', fn (Request $request) => Limit::perMinute(self::DOCS_PER_MINUTE)->by((string) $request->ip()));
    }
}
