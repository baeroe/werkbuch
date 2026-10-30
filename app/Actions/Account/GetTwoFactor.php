<?php

namespace App\Actions\Account;

use App\Access\Authorize;
use App\Models\User;
use App\Support\Actor;
use Lorisleiva\Actions\Concerns\AsAction;

/**
 * Whether the second factor of the own account is on, since when, and how many recovery codes are left. A setup that
 * was started but not confirmed is still off.
 */
final class GetTwoFactor
{
    use AsAction;

    /**
     * @return array{enabled: bool, confirmed_at: string|null, recovery_codes_left: int}
     */
    public function handle(Actor $actor): array
    {
        Authorize::check($actor, 'manageSignIn', User::class);
        $user = $actor->user;
        $enabled = $user->hasEnabledTwoFactorAuthentication();

        return [
            'enabled' => $enabled,
            'confirmed_at' => $enabled ? $user->two_factor_confirmed_at?->toJSON() : null,
            'recovery_codes_left' => $enabled ? count($user->recoveryCodes()) : 0,
        ];
    }
}
