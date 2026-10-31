<?php

namespace App\Actions\Auth;

use App\Events\EventRecorder;
use App\Events\EventType;
use App\Models\User;
use App\Support\Actor;
use Illuminate\Support\Facades\DB;
use Laravel\Fortify\Contracts\TwoFactorAuthenticationProvider;
use Laravel\Fortify\Fortify;
use Lorisleiva\Actions\Concerns\AsAction;

/**
 * Checks the second step of a sign-in: a recovery code if one is given, else the code of the authenticator app. A
 * recovery code works once, also when two requests bring it at the same time: the row is read again under a lock, and
 * only a code still in it counts (and leaves it, event `user.recovery_code_used`).
 */
final class PassTwoFactorChallenge
{
    use AsAction;

    public function __construct(private readonly TwoFactorAuthenticationProvider $codes) {}

    public function handle(User $user, ?string $code, #[\SensitiveParameter] ?string $recoveryCode): bool
    {
        if ($recoveryCode !== null && $recoveryCode !== '') {
            return $this->useRecoveryCode($user, $recoveryCode);
        }

        return $code !== null && $code !== ''
            && $this->codes->verify(Fortify::currentEncrypter()->decrypt((string) $user->two_factor_secret), $code);
    }

    private function useRecoveryCode(User $user, #[\SensitiveParameter] string $code): bool
    {
        return DB::transaction(function () use ($user, $code): bool {
            $locked = User::query()->whereKey($user->id)->lockForUpdate()->firstOrFail();
            // turned off meanwhile: no codes any more
            $codes = $locked->two_factor_recovery_codes === null ? [] : $locked->recoveryCodes();
            $left = array_values(array_filter($codes, fn (string $stored) => ! hash_equals($stored, $code)));

            if (count($left) === count($codes)) {
                return false;
            }

            $locked->forceFill(['two_factor_recovery_codes' => Fortify::currentEncrypter()->encrypt((string) json_encode($left))])->save();
            EventRecorder::record(EventType::UserRecoveryCodeUsed, Actor::system($locked, 'two_factor_challenge'), $locked, null);
            // the instance the sign-in goes on with knows the list that is left
            $user->setRawAttributes($locked->getAttributes(), true);

            return true;
        });
    }
}
