<?php

namespace App\Actions\Account;

use App\Access\Authorize;
use App\Events\EventRecorder;
use App\Events\EventType;
use App\Exceptions\Problem;
use App\Models\User;
use App\Support\Actor;
use Illuminate\Support\Facades\DB;
use Laravel\Fortify\Actions\GenerateNewRecoveryCodes;
use Lorisleiva\Actions\Concerns\AsAction;

/**
 * Eight new recovery codes for the own second factor; the old ones stop working. The answer is the one time they show.
 */
final class RegenerateRecoveryCodes
{
    use AsAction;

    public function __construct(private readonly GenerateNewRecoveryCodes $generate) {}

    /**
     * @return array{recovery_codes: list<string>}
     *
     * @throws Problem 409 `two_factor_disabled` while the second factor is off
     */
    public function handle(Actor $actor): array
    {
        Authorize::check($actor, 'manageSignIn', User::class);
        $user = $actor->user;

        if (! $user->hasEnabledTwoFactorAuthentication()) {
            throw Problem::conflict('two_factor_disabled');
        }

        DB::transaction(function () use ($actor, $user): void {
            ($this->generate)($user);
            EventRecorder::record(EventType::UserRecoveryCodesRegenerated, $actor, $user, null);
        });

        return ['recovery_codes' => $user->recoveryCodes()];
    }
}
