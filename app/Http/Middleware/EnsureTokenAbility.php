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
        $declared = $route instanceof Route ? ($route->defaults['token_ability'] ?? null) : null;
        $ability = is_string($declared) ? $declared : (in_array($request->getMethod(), ['GET', 'HEAD'], true) ? 'read' : 'write');

        if ($token instanceof PersonalAccessToken && ! $token->can($ability)) {
            throw Problem::forbidden(__('problem.detail.token_ability', ['ability' => $ability]));
        }

        return $next($request);
    }
}
