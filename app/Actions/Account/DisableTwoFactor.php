<?php

namespace App\Actions\Account;

use App\Access\Authorize;
use App\Events\EventRecorder;
use App\Events\EventType;
use App\Models\User;
use App\Support\Actor;
use Illuminate\Support\Facades\DB;
use Laravel\Fortify\Actions\DisableTwoFactorAuthentication;
use Lorisleiva\Actions\Concerns\AsAction;

/**
 * Turns the second factor off (P19: without asking for the password again, only from the session), event
 * `user.two_factor_disabled`, or drops a setup that was started and not confirmed, event `user.two_factor_setup_cancelled`;
 * secret and recovery codes are gone. Off already: nothing happens, no event. The settings throw a setup away with
 * `onlyUnconfirmed` (`?unconfirmed=1`): a setup that got confirmed meanwhile stays on.
 */
final class DisableTwoFactor
{
    use AsAction;

    public function __construct(private readonly DisableTwoFactorAuthentication $disable) {}

    /**
     * @param  bool  $onlyUnconfirmed  drop a setup that is not confirmed, never switch a confirmed second factor off
     */
    public function handle(Actor $actor, bool $onlyUnconfirmed = false): void
    {
        Authorize::check($actor, 'manageSignIn', User::class);
        $user = $actor->user;

        DB::transaction(function () use ($actor, $user, $onlyUnconfirmed): void {
            // under the lock of the account: a confirmation at the same time (ConfirmTwoFactor) comes first or after
            $user->setRawAttributes(User::query()->whereKey($user->id)->lockForUpdate()->firstOrFail()->getAttributes(), true);

            if ($user->two_factor_secret === null && $user->two_factor_recovery_codes === null && $user->two_factor_confirmed_at === null) {
                return;
            }

            if ($onlyUnconfirmed && $user->two_factor_confirmed_at !== null) {
                return;
            }

            $type = $user->two_factor_confirmed_at === null ? EventType::UserTwoFactorSetupCancelled : EventType::UserTwoFactorDisabled;
            ($this->disable)($user);
            EventRecorder::record($type, $actor, $user, null);
        });
    }
}
