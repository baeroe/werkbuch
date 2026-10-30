<?php

namespace App\Actions\Auth;

use App\Models\User;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Str;
use Lorisleiva\Actions\Concerns\AsAction;

/**
 * Checks the sign-in of a person: an active person whose password matches, else null (Fortify counts that as a failed
 * attempt). Every call checks exactly one hash, also for unknown addresses, bots and accounts without a password, so the
 * answer time does not tell whether an account exists. A password hashed with older settings is hashed anew on success.
 */
final class Authenticate
{
    use AsAction;

    /**
     * The hash an attempt without a usable password is checked against: a random secret nobody knows, hashed with the
     * configured hasher and its settings (so it costs as much as a real check and the hasher accepts it). Made once per
     * hasher configuration and kept in the cache, so no request pays for making it.
     */
    public static function dummyHash(): string
    {
        $key = 'auth.dummy-hash:'.hash('sha256', (string) json_encode([config('hashing.driver'), config('hashing.bcrypt'), config('hashing.argon')]));

        return Cache::rememberForever($key, fn (): string => Hash::make(Str::random(40)));
    }

    public function handle(string $email, #[\SensitiveParameter] string $password): ?User
    {
        $user = User::query()->where('email', $email)->first();
        // fetched for every attempt, so known and unknown addresses do the same work
        $dummy = self::dummyHash();
        $matches = Hash::check($password, $user->password ?? $dummy);

        if (! $matches || ! $user?->isPerson() || $user->isDisabled()) {
            return null;
        }

        // the hasher settings went up since the password was set: store it with the current ones (technical, no event)
        if (Hash::needsRehash((string) $user->password)) {
            $user->forceFill(['password' => $password])->save();
        }

        return $user;
    }
}
