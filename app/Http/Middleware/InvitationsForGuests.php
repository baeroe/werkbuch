<?php

namespace App\Http\Middleware;

use Closure;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Auth;
use Symfony\Component\HttpFoundation\Response;

/**
 * An invitation is for somebody without an account of this session: whoever is signed in goes to their items, with a
 * note why (Laravel's `guest` would send them there silently).
 */
final class InvitationsForGuests
{
    /**
     * @param  Closure(Request): Response  $next
     */
    public function handle(Request $request, Closure $next): Response
    {
        if (Auth::guard((string) config('fortify.guard'))->check()) {
            return redirect('/my-items')->with('status', __('invitation.sign_out_first'));
        }

        return $next($request);
    }
}
