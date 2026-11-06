<?php

namespace App\Http\Middleware;

use App\Exceptions\Problem;
use App\Models\PersonalAccessToken;
use App\Models\User;
use Closure;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;

/**
 * Only a personal access token with the ability `mcp` talks to /mcp (spec 6.2, A401), after `auth:sanctum`. The session
 * of the interface never gets this far (without the group `web` the cookie signs nobody in, 401); a guard that knows the
 * person already hands Sanctum a TransientToken, whose can() says yes to everything: the ability is checked at the
 * PersonalAccessToken itself, never through tokenCan() (K2).
 */
final class EnsureMcpToken
{
    /**
     * @param  Closure(Request): Response  $next
     *
     * @throws Problem 403 `token_required` without a personal access token, 403 `forbidden` without the ability `mcp`
     */
    public function handle(Request $request, Closure $next): Response
    {
        $user = $request->user();
        $token = $user instanceof User ? $user->currentAccessToken() : null;

        if (! $token instanceof PersonalAccessToken) {
            throw Problem::forbidden(__('problem.detail.mcp_token'), 'token_required');
        }

        if (! $token->can('mcp')) {
            throw Problem::forbidden(__('problem.detail.token_ability', ['ability' => 'mcp']));
        }

        return $next($request);
    }
}
