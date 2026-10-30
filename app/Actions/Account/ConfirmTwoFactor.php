<?php

namespace App\Actions\Account;

use App\Access\Authorize;
use App\Events\EventRecorder;
use App\Events\EventType;
use App\Exceptions\Problem;
use App\Models\User;
use App\Support\Actor;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\ValidationException;
use Laravel\Fortify\Actions\ConfirmTwoFactorAuthentication;
use Lorisleiva\Actions\Concerns\AsAction;

/**
 * Turns the second factor on with the first code of the authenticator app; answers the recovery codes, which the
 * settings show this once. A wrong code keeps the setup open.
 */
final class ConfirmTwoFactor
{
    use AsAction;

    public function __construct(private readonly ConfirmTwoFactorAuthentication $confirm) {}

    /**
     * @return array{recovery_codes: list<string>}
     *
     * @throws Problem 409 `two_factor_not_pending` without a started setup
     * @throws ValidationException at `code` for a wrong code
     */
    public function handle(Actor $actor, #[\SensitiveParameter] string $code): array
    {
        Authorize::check($actor, 'manageSignIn', User::class);
        $user = $actor->user;

        if ($user->two_factor_secret === null || $user->two_factor_confirmed_at !== null) {
            throw Problem::conflict('two_factor_not_pending');
        }

        DB::transaction(function () use ($actor, $user, $code): void {
            try {
                ($this->confirm)($user, $code);
            } catch (ValidationException) {
                throw ValidationException::withMessages(['code' => __('field.code.wrong')]);
            }

            EventRecorder::record(EventType::UserTwoFactorEnabled, $actor, $user, null);
        });

        return ['recovery_codes' => $user->recoveryCodes()];
    }
}
