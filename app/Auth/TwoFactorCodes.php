<?php

namespace App\Auth;

use Laravel\Fortify\TwoFactorAuthenticationProvider;

/**
 * Fortify's check of a TOTP code, with the memory of used codes per secret (and so per account) instead of per code:
 * Fortify's key `md5(code)` let a code one person used fail for everybody else within its window. A code still counts
 * once only, also when two requests check it at the same moment; the memory lasts as long as the window accepts it
 * ((2 · window + 1) · 30 s).
 */
final class TwoFactorCodes extends TwoFactorAuthenticationProvider
{
    /**
     * @param  string  $secret
     * @param  string  $code
     */
    public function verify($secret, $code): bool
    {
        if (is_int($window = config('fortify-options.two-factor-authentication.window'))) {
            $this->engine->setWindow($window);
        }

        $key = 'fortify.2fa_codes.'.hash('sha256', $secret.'|'.$code);
        $timestamp = $this->engine->verifyKeyNewer($secret, $code, $this->cache?->get($key));

        if ($timestamp === false) {
            return false;
        }

        // `add` stores only if nothing is there yet (atomic in the store): of two checks that both passed, one wins
        $ttl = (2 * (int) $this->engine->getWindow() + 1) * 30;

        return $this->cache === null || $this->cache->add($key, $timestamp === true ? $this->engine->getTimestamp() : $timestamp, $ttl);
    }
}
