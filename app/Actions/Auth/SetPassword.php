<?php

namespace App\Actions\Auth;

use App\Models\User;
use App\Support\PasswordRules;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Validator;
use Illuminate\Support\Str;
use Illuminate\Validation\ValidationException;
use Lorisleiva\Actions\Concerns\AsAction;

/**
 * Sets a new password: checks the rules, renews the remember token and ends every session of the account.
 */
final class SetPassword
{
    use AsAction;

    /**
     * @throws ValidationException when the password breaks the rules; nothing changes then
     */
    public function handle(User $user, string $password): void
    {
        Validator::make(['password' => $password], ['password' => PasswordRules::rules()])->validate();

        DB::transaction(function () use ($user, $password): void {
            $user->forceFill(['password' => $password, 'remember_token' => Str::random(60)])->save();
            DB::table('sessions')->where('user_id', $user->id)->delete();
        });
    }
}
