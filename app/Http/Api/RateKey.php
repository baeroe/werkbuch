<?php

namespace App\Http\Api;

use App\Models\PersonalAccessToken;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Auth;

/**
 * Whose quota a request of the API spends (A387, K9). Throttles run before auth (the priority list in bootstrap/app.php),
 * so `$request->user()` knows no token yet; the key is found here:
 *
 * - `token:<id>`: a bearer token Sanctum would take (found, secret right, not expired); the account need not be active,
 *   the request then fails at EnsureAccountIsActive, having spent only the token's own quota;
 * - `user:<id>`: the session of the web app (guard `web`), one quota per account, not per address (an office behind NAT);
 * - `ip:<address>`: everything else, also an unknown, expired or revoked token and every request that fails auth, so a
 *   flood of 401 never spends the quota of a valid token.
 *
 * `account()` is the key of the throttles of single routes (uploads, test ping, test mail): per account, whether it
 * sends a token or the session. `session()` is the key of a throttle in front of a route that takes only the session
 * (`EnsureSession`, the own password): a token, refused there anyway, counts by its address and never spends the tries
 * of the account.
 */
final class RateKey
{
    public const TOKEN = 'token:';

    public const USER = 'user:';

    public const IP = 'ip:';

    private const FOUND = 'werkbuch.rate_token';

    public static function for(Request $request): string
    {
        $token = self::token($request);

        return $token === null ? self::session($request) : self::TOKEN.$token->getKey();
    }

    public static function account(Request $request): string
    {
        $token = self::token($request);

        return $token === null ? self::session($request) : self::USER.$token->tokenable_id;
    }

    /** Whether the key is the session of the web app, which has a limit of its own (`rate_limits.api_session`). */
    public static function isSession(string $key): bool
    {
        return str_starts_with($key, self::USER);
    }

    /** The account of the session of the web app (guard `web`), else the address; a token does not count. */
    public static function session(Request $request): string
    {
        $user = Auth::guard('web')->user();

        return $user === null ? self::IP.$request->ip() : self::USER.$user->getAuthIdentifier();
    }

    /** The token of the request, looked up once per request (the throttle of the group and of the route both ask). */
    private static function token(Request $request): ?PersonalAccessToken
    {
        if (! $request->attributes->has(self::FOUND)) {
            $plain = $request->bearerToken();
            $token = $plain === null ? null : PersonalAccessToken::findToken($plain);
            $valid = $token instanceof PersonalAccessToken && ($token->expires_at === null || ! $token->expires_at->isPast());
            $request->attributes->set(self::FOUND, $valid ? $token : null);
        }

        $found = $request->attributes->get(self::FOUND);

        return $found instanceof PersonalAccessToken ? $found : null;
    }
}
