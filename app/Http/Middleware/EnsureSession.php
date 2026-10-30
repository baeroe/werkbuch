<?php

namespace App\Http\Middleware;

use App\Exceptions\Problem;
use App\Models\PersonalAccessToken;
use App\Models\User;
use Closure;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;

/**
 * What only the session of the interface may do (P6): the own password and the second factor (/api/v1/me/*). A stolen
 * token must neither change the password nor turn the second factor on or off, whatever its abilities; it runs before
 * EnsureTokenAbility (priority list, P28), so a token always hears `session_required`.
 */
final class EnsureSession
{
    /**
     * @param  Closure(Request): Response  $next
     *
     * @throws Problem 403 `session_required` for a bearer token
     */
    public function handle(Request $request, Closure $next): Response
    {
        $user = $request->user();

        if ($user instanceof User && $user->currentAccessToken() instanceof PersonalAccessToken) {
            throw Problem::forbidden(__('problem.reason.session_required'), 'session_required');
        }

        return $next($request);
    }
}
