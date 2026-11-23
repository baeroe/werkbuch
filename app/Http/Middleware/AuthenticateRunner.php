<?php

namespace App\Http\Middleware;

use App\Http\Api\RunnerKey;
use Closure;
use Illuminate\Auth\AuthenticationException;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;

/**
 * The runner protocol takes only the token of a runner (spec 6.1, A472): no session, no personal access token. An
 * unknown or revoked token is a 401 problem; the runner then has to be paired again.
 */
final class AuthenticateRunner
{
    /**
     * @param  Closure(Request): Response  $next
     *
     * @throws AuthenticationException
     */
    public function handle(Request $request, Closure $next): Response
    {
        if (RunnerKey::runner($request) === null) {
            throw new AuthenticationException;
        }

        return $next($request);
    }
}
