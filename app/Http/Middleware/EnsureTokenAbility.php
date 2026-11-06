<?php

namespace App\Http\Middleware;

use App\Exceptions\Problem;
use App\Models\PersonalAccessToken;
use App\Models\User;
use Closure;
use Illuminate\Http\Request;
use Illuminate\Routing\Route;
use Symfony\Component\HttpFoundation\Response;

/**
 * What an API token may do (spec 6.1): reading (GET, HEAD) needs the ability `read`, everything else `write`; a route
 * that only reads through a body (`POST /work-items/query`, P15) says so with its default `token_ability`. The session
 * of the interface is not a token and may do both; what the account may do is up to the actions.
 */
final class EnsureTokenAbility
{
    /**
     * @param  Closure(Request): Response  $next
     *
     * @throws Problem 403 without the ability
     */
    public function handle(Request $request, Closure $next): Response
    {
        $user = $request->user();
        $token = $user instanceof User ? $user->currentAccessToken() : null;
        $route = $request->route();
        $ability = self::required($route instanceof Route ? $route : null, $request->getMethod());

        if ($token instanceof PersonalAccessToken && ! $token->can($ability)) {
            throw Problem::forbidden(__('problem.detail.token_ability', ['ability' => $ability]));
        }

        return $next($request);
    }

    /**
     * The ability a token needs for a route and method: the route's default `token_ability`, else `read` for `GET` and
     * `HEAD` and `write` for everything else. The OpenAPI document says the same (`x-werkbuch-ability`).
     */
    public static function required(?Route $route, string $method): string
    {
        $declared = $route?->defaults['token_ability'] ?? null;

        return is_string($declared) ? $declared : (in_array(strtoupper($method), ['GET', 'HEAD'], true) ? 'read' : 'write');
    }
}
