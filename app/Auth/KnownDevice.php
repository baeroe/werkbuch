<?php

namespace App\Auth;

use App\Actions\Auth\FindChallengedUser;
use App\Models\User;
use Illuminate\Auth\Events\Login;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Cookie;
use Illuminate\Support\Str;
use Laravel\Fortify\Fortify;

/**
 * A browser that once signed in to an address with its current password (OWASP "device cookies", A434): after every
 * sign-in, also after the second factor and through the remember cookie, it gets `werkbuch_device` with an HMAC of the
 * address and the password stamp (FindChallengedUser::passwordStamp) under APP_KEY, for a year. A new password revokes
 * every device of the account; a change in the own browser (`keepSession`) sets its cookie anew (`renew`). EncryptCookies
 * encrypts it like every cookie and binds it to its name, so neither a value made elsewhere nor the plain HMAC counts.
 * The cap per account (AccountLoginRateLimiter) lets such a browser through; the other limits hold it like any other.
 * Registered with Event::listen in the FortifyServiceProvider, not under app/Listeners (discovered there, it would run
 * twice).
 */
final class KnownDevice
{
    public const NAME = 'werkbuch_device';

    public const MINUTES = 60 * 24 * 365;

    public function remember(Login $event): void
    {
        if ($event->user instanceof User) {
            self::renew($event->user);
        }
    }

    /**
     * Sets the cookie of the running request's browser for the account as it is now (no address: none).
     */
    public static function renew(User $user): void
    {
        if ($user->email === null) {
            return;
        }

        Cookie::queue(Cookie::make(self::NAME, self::token($user), self::MINUTES, secure: config('session.secure'), httpOnly: true, sameSite: 'lax'));
    }

    /**
     * Whether the request comes from a browser that signed in to the address it sends with the current password. Reads
     * the account, so the limiter asks only once the address is locked; an unknown address never matches.
     */
    public static function matches(Request $request): bool
    {
        $cookie = $request->cookie(self::NAME);
        $email = $request->input(Fortify::username());

        if (! is_string($cookie) || ! is_string($email)) {
            return false;
        }

        $user = User::query()->where('email', Str::trim($email))->first();

        return $user !== null && hash_equals(self::token($user), $cookie);
    }

    private static function token(User $user): string
    {
        return hash_hmac('sha256', AccountLoginRateLimiter::address((string) $user->email).'|'.FindChallengedUser::passwordStamp($user), (string) config('app.key'));
    }
}
