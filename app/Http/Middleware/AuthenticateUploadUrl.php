<?php

namespace App\Http\Middleware;

use App\Exceptions\Problem;
use App\Models\PersonalAccessToken;
use App\Models\User;
use Closure;
use Illuminate\Auth\AuthenticationException;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\App;
use Illuminate\Support\Facades\Auth;
use Symfony\Component\HttpFoundation\Response;

/**
 * Signs in the account of an upload address of MCP (IssueUploadUrl, K11), after `signed` has checked the address: the
 * personal access token it names by its ID (route parameter `token`), as it is now. A token that is gone (revoked),
 * expired, or whose account was deactivated is a 401; one that lost `write` or `mcp` a 403, checked at the token itself,
 * never through tokenCan() (K2). The account then acts through the guard `sanctum` as with its bearer token
 * (`Actor::fromMcp` reads `$request->user()`, hence `shouldUse`). Once the account is known it speaks its language, a 403
 * included: SetLocale ran before, when no account was known yet.
 */
final class AuthenticateUploadUrl
{
    /**
     * @param  Closure(Request): Response  $next
     *
     * @throws AuthenticationException
     * @throws Problem
     */
    public function handle(Request $request, Closure $next): Response
    {
        $id = $request->route('token');
        $token = is_string($id) ? PersonalAccessToken::query()->find($id) : null;
        $user = $token?->tokenable;

        if ($token === null || ($token->expires_at !== null && $token->expires_at->isPast()) || ! $user instanceof User || $user->isDisabled()) {
            throw new AuthenticationException;
        }

        App::setLocale($user->effectiveLocale()->value);

        if (! $token->can('write') || ! $token->can('mcp')) {
            throw Problem::forbidden(__('problem.detail.token_ability', ['ability' => $token->can('mcp') ? 'write' : 'mcp']));
        }

        Auth::shouldUse('sanctum');
        Auth::guard('sanctum')->setUser($user->withAccessToken($token));

        return $next($request);
    }
}
