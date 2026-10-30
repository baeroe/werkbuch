<?php

namespace App\Http\Middleware;

use App\Models\User;
use Closure;
use Illuminate\Auth\AuthenticationException;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Auth;
use Symfony\Component\HttpFoundation\Response;

/**
 * Ends the session of an account that was disabled while it was signed in (P8, any session driver): the next request
 * signs it out. Pages go to the sign-in with a note why, the API answers 401.
 */
final class EnsureAccountIsActive
{
    /**
     * @param  Closure(Request): Response  $next
     *
     * @throws AuthenticationException under /api
     */
    public function handle(Request $request, Closure $next): Response
    {
        $user = $request->user();

        if (! $user instanceof User || ! $user->isDisabled()) {
            return $next($request);
        }

        Auth::guard('web')->logout();

        if ($request->hasSession()) {
            $request->session()->invalidate();
            $request->session()->regenerateToken();
        }

        if ($request->is('api/*')) {
            throw new AuthenticationException;
        }

        return redirect()->route('login')->with('error', __('errors.account_disabled'));
    }
}
