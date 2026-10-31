<?php

namespace App\Actions\Auth;

use App\Events\EventRecorder;
use App\Events\EventType;
use App\Models\User;
use App\Support\Actor;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use Laravel\Fortify\Actions\DisableTwoFactorAuthentication;
use Lorisleiva\Actions\Concerns\AsAction;

/**
 * The way back for a person who lost the authenticator app and the recovery codes (`app:reset-two-factor`): the second
 * factor goes off, the stored sessions and the remember cookie end, the event `user.two_factor_disabled` names the
 * reset. The person signs in with the password and sets the second factor up again.
 */
final class ResetTwoFactor
{
    use AsAction;

    public function __construct(private readonly DisableTwoFactorAuthentication $disable) {}

    /**
     * @return bool false when the second factor was off already (nothing changes)
     */
    public function handle(User $user): bool
    {
        if ($user->two_factor_secret === null && $user->two_factor_recovery_codes === null && $user->two_factor_confirmed_at === null) {
            return false;
        }

        DB::transaction(function () use ($user): void {
            ($this->disable)($user);
            $user->forceFill(['remember_token' => Str::random(60)])->save();
            EndSessions::run($user);
            EventRecorder::record(EventType::UserTwoFactorDisabled, Actor::system($user, 'two_factor_reset'), $user, null);
        });

        return true;
    }
}
