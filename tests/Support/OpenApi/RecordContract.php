<?php

namespace Tests\Support\OpenApi;

use Closure;
use Illuminate\Http\Request;
use Illuminate\Routing\Route;
use Symfony\Component\HttpFoundation\Response;

/**
 * The middleware of the contract (A385), first in the HTTP kernel of every test (`TestCase::setUp`): after the app
 * answered, it hands the exchange of a route of the contract (under `api/v1`, a controller of the app, no test route
 * under `_t/`) to `Contract::record()`. It only keeps it; the check runs in `TestCase::tearDown` (K3).
 */
final class RecordContract
{
    public function handle(Request $request, Closure $next): Response
    {
        /** @var Response $response */
        $response = $next($request);

        // the route of this request, never Route::current(): an unknown path leaves that one of the request before
        $route = $request->route();

        if ($request->is('api/v1/*') && $route instanceof Route && Document::documents($route)) {
            Contract::record($request, $response);
        }

        return $response;
    }
}
