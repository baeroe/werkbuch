<?php

namespace App\Auth;

use App\Models\User;
use Illuminate\Auth\Events\Login;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Cookie;

/**
 * A browser that once signed in to an address (OWASP "device cookies", A434): after every sign-in, also after the second
 * factor and through the remember cookie, it gets `werkbuch_device` with an HMAC of the address under APP_KEY, for a
 * year. EncryptCookies encrypts it like every cookie and binds it to its name, so neither a value made elsewhere nor the
 * plain HMAC counts. The cap per account (AccountLoginRateLimiter) lets such a browser through; the other limits hold it
 * like any other. Registered with Event::listen in the FortifyServiceProvider, not under app/Listeners (discovered
 * there, it would run twice).
 */
final class KnownDevice
{
    public const NAME = 'werkbuch_device';

    public const MINUTES = 60 * 24 * 365;

    public function remember(Login $event): void
    {
        $email = $event->user instanceof User ? $event->user->email : null;

        if ($email === null) {
            return;
        }

        Cookie::queue(Cookie::make(self::NAME, self::token($email), self::MINUTES, secure: config('session.secure'), httpOnly: true, sameSite: 'lax'));
    }

    /**
     * Whether the request comes from a browser that signed in to this address.
     */
    public static function matches(Request $request, string $email): bool
    {
        $cookie = $request->cookie(self::NAME);

        return is_string($cookie) && hash_equals(self::token($email), $cookie);
    }

    private static function token(string $email): string
    {
        return hash_hmac('sha256', AccountLoginRateLimiter::address($email), (string) config('app.key'));
    }
}
