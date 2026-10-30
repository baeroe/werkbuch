<?php

namespace App\Http\Middleware;

use App\Exceptions\Problem;
use App\Models\PersonalAccessToken;
use App\Models\User;
use Closure;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;

/**
 * What an API token may do (spec 6.1): reading (GET, HEAD) needs the ability `read`, everything else `write`. The
 * session of the interface is not a token and may do both; what the account may do is up to the actions.
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
        $ability = in_array($request->getMethod(), ['GET', 'HEAD'], true) ? 'read' : 'write';

        if ($token instanceof PersonalAccessToken && ! $token->can($ability)) {
            throw Problem::forbidden(__('problem.detail.token_ability', ['ability' => $ability]));
        }

        return $next($request);
    }
}
