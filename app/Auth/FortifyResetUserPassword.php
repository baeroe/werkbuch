<?php

namespace App\Auth;

use App\Actions\Auth\SetPassword;
use App\Models\User;
use Illuminate\Support\Facades\Validator;
use Illuminate\Validation\ValidationException;
use Laravel\Fortify\Contracts\ResetsUserPasswords;

/**
 * Fortify's step "set the new password" of the reset link: checks that the password was repeated and hands over to
 * SetPassword, the only place with the password rules (its ValidationException passes through unchanged).
 */
final class FortifyResetUserPassword implements ResetsUserPasswords
{
    public function __construct(private readonly SetPassword $setPassword) {}

    /**
     * @param  array<string, mixed>  $input
     *
     * @throws ValidationException
     */
    public function reset(User $user, array $input): void
    {
        Validator::make($input, ['password' => ['confirmed']])->validate();

        $this->setPassword->handle($user, (string) $input['password']);
    }
}
