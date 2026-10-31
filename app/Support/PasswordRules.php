<?php

namespace App\Support;

use Illuminate\Validation\Rules\Password;

/**
 * The rules for a new password: SetPassword applies them to every password it sets, EnsureAdmin to the first account.
 */
final class PasswordRules
{
    public const MIN_LENGTH = 8;

    /**
     * @return list<mixed>
     */
    public static function rules(): array
    {
        return ['required', 'string', Password::min(self::MIN_LENGTH)];
    }
}
