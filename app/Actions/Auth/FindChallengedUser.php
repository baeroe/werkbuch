<?php

namespace App\Actions\Auth;

use App\Models\User;
use Lorisleiva\Actions\Concerns\AsAction;

/**
 * The person of a two-factor challenge that was started (`login.id` and the password stamp in the session), as long as
 * the challenge still counts: an active person whose second factor is on and whose password did not change since. A
 * challenge whose account changed meanwhile (second factor turned off elsewhere, password changed, deactivated) has to
 * start again with the password.
 */
final class FindChallengedUser
{
    use AsAction;

    /** What the session keeps of the password: never the hash itself, only a keyed digest of it. */
    public static function passwordStamp(User $user): string
    {
        return hash_hmac('sha256', (string) $user->password, (string) config('app.key'));
    }

    public function handle(mixed $id, mixed $stamp): ?User
    {
        $user = is_string($id) && is_string($stamp) ? User::query()->find($id) : null;

        return $user !== null && $user->isPerson() && ! $user->isDisabled() && $user->hasEnabledTwoFactorAuthentication()
            && hash_equals(self::passwordStamp($user), $stamp) ? $user : null;
    }
}
