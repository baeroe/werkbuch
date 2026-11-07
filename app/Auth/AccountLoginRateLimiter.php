<?php

namespace App\Auth;

use Illuminate\Http\Request;
use Illuminate\Support\Str;
use Laravel\Fortify\Fortify;
use Laravel\Fortify\LoginRateLimiter;

/**
 * Fortify's lock per lower(email)|IP plus a cap per address over all IPs (A434): behind a forgeable X-Forwarded-For
 * every limit per IP is moot, so at most `rate_limits.login_per_account` failures count per address within
 * `rate_limits.login_account_decay` seconds. The cap does not hold a device that once signed in to exactly this address
 * with its current password (KnownDevice), so whoever knows only the address never locks the owner out on her own
 * browser. Bound as Fortify's LoginRateLimiter, it reaches the lock, the counting, the second factor, the session and the
 * lockout answer of the pipeline (A445).
 */
final class AccountLoginRateLimiter extends LoginRateLimiter
{
    public const PREFIX = 'login-account:';

    /**
     * The address as the cap and the device cookie count it: trimmed, lower-cased and transliterated like Fortify's own
     * key (`Ä` and `ä` count alike).
     */
    public static function address(string $email): string
    {
        return Str::transliterate(Str::lower(Str::trim($email)));
    }

    public function tooManyAttempts(Request $request): bool
    {
        return parent::tooManyAttempts($request) || $this->accountLocked($request);
    }

    public function increment(Request $request): void
    {
        parent::increment($request);

        $address = self::addressOf($request);

        if ($address !== null) {
            $this->limiter->hit(self::PREFIX.$address, (int) config('werkbuch.rate_limits.login_account_decay'));
        }
    }

    /**
     * The longest wait of the limits that hold the request.
     */
    public function availableIn(Request $request): int
    {
        $address = self::addressOf($request);

        return max(
            parent::tooManyAttempts($request) ? (int) parent::availableIn($request) : 0,
            $address !== null && $this->accountLocked($request) ? $this->limiter->availableIn(self::PREFIX.$address) : 0,
        );
    }

    public function clear(Request $request): void
    {
        parent::clear($request);

        $address = self::addressOf($request);

        if ($address !== null) {
            $this->clearAccount($address);
        }
    }

    /**
     * Clears only the cap of this address: a sign-in after the second factor, a new password.
     */
    public function clearAccount(string $email): void
    {
        $this->limiter->clear(self::PREFIX.self::address($email));
    }

    private function accountLocked(Request $request): bool
    {
        $address = self::addressOf($request);

        return $address !== null
            && $this->limiter->tooManyAttempts(self::PREFIX.$address, (int) config('werkbuch.rate_limits.login_per_account'))
            && ! KnownDevice::matches($request);
    }

    /**
     * The address of the request, or null when it sent none as text (then only Fortify's lock counts).
     */
    private static function addressOf(Request $request): ?string
    {
        $email = $request->input(Fortify::username());

        return is_string($email) ? self::address($email) : null;
    }
}
