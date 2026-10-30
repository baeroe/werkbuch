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
 * Turns the second factor off (P19: without asking for the password again, only from the session) and drops a setup
 * that was started; secret and recovery codes are gone. Off already: nothing happens, no event.
 */
final class DisableTwoFactor
{
    use AsAction;

    public function __construct(private readonly DisableTwoFactorAuthentication $disable) {}

    public function handle(Actor $actor): void
    {
        Authorize::check($actor, 'manageSignIn', User::class);
        $user = $actor->user;

        if ($user->two_factor_secret === null && $user->two_factor_recovery_codes === null && $user->two_factor_confirmed_at === null) {
            return;
        }

        DB::transaction(function () use ($actor, $user): void {
            ($this->disable)($user);
            EventRecorder::record(EventType::UserTwoFactorDisabled, $actor, $user, null);
        });
    }
}
