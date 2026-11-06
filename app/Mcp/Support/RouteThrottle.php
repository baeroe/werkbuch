<?php

namespace App\Mcp\Support;

use Illuminate\Http\Exceptions\ThrottleRequestsException;
use Illuminate\Http\Request;
use Illuminate\Routing\Exceptions\MissingRateLimiterException;
use Illuminate\Routing\Middleware\ThrottleRequests;
use Symfony\Component\HttpFoundation\Response;

/**
 * The throttle of a REST route for an MCP action that does the same (K16): a ping of a webhook counts in `webhook-send`
 * whether it came over REST or MCP. It runs Laravel's own handling of a named limiter, so the counter is the same one
 * (`md5(<name>.<key>)`) and an exhausted quota throws the same `ThrottleRequestsException` with `Retry-After`.
 */
final class RouteThrottle extends ThrottleRequests
{
    /**
     * Count one call in the named limiter, as the route throttle `throttle:<limiter>` counts a request.
     *
     * @throws ThrottleRequestsException when the quota is spent
     * @throws MissingRateLimiterException for a limiter that is not defined
     */
    public static function hit(string $limiter, Request $http): void
    {
        $throttle = app(self::class);
        $named = $throttle->limiter->limiter($limiter) ?? throw MissingRateLimiterException::forLimiter($limiter);

        $throttle->handleRequestUsingNamedLimiter($http, fn (): Response => new Response, $limiter, $named);
    }
}
