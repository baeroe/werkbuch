<?php

namespace App\Auth;

/**
 * The cache key of the day's budget of second-factor attempts of an account (A435). Laravel's throttle middleware
 * stores a named limiter under md5(<limiter name><key>), so clearing the budget needs that hashed key, not the one the
 * limiter names.
 */
final class TwoFactorDay
{
    private const LIMITER = 'two-factor';

    /** The key the limiter hands to the throttle middleware. */
    public static function limiterKey(string $accountId): string
    {
        return 'two-factor-day:'.$accountId;
    }

    /** The key the budget has in the cache (for `RateLimiter::clear()` and `attempts()`). */
    public static function cacheKey(string $accountId): string
    {
        return md5(self::LIMITER.self::limiterKey($accountId));
    }
}
