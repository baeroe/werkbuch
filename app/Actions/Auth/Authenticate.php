<?php

namespace App\Actions\Auth;

use App\Models\User;
use Illuminate\Support\Facades\Hash;
use Lorisleiva\Actions\Concerns\AsAction;

/**
 * Checks the sign-in of a person: an active person whose password matches, else null (Fortify counts that as a failed
 * attempt). Every call checks exactly one hash, also for unknown addresses, bots and accounts without a password, so the
 * answer time does not tell whether an account exists.
 */
final class Authenticate
{
    use AsAction;

    /**
     * A bcrypt hash (cost 12, the default of BCRYPT_ROUNDS) of a random secret nobody knows: what an attempt without a
     * usable password is checked against.
     */
    public const DUMMY_HASH = '$2y$12$CVpjV8T7k2J0HONkBQQ4GuDCxFKVSaOowxJEWsh7yzIb5RzPZ5W7W';

    public function handle(string $email, string $password): ?User
    {
        $user = User::query()->where('email', $email)->first();
        $matches = Hash::check($password, $user->password ?? self::DUMMY_HASH);

        return $matches && $user?->isPerson() && ! $user->isDisabled() ? $user : null;
    }
}
