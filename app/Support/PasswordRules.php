<?php

namespace App\Support;

use Illuminate\Validation\Rules\Password;

/**
 * The rules for a new password; SetPassword is the only place that applies them.
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
