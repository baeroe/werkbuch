<?php

namespace App\Actions\Account;

use App\Access\Authorize;
use App\Actions\Auth\SetPassword;
use App\Models\User;
use App\Support\Actor;
use Closure;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Facades\Validator;
use Illuminate\Validation\ValidationException;
use Lorisleiva\Actions\Concerns\AsAction;

/**
 * A person changes their own password (spec 4.2): the current one first, the new one twice. Everything else is
 * SetPassword's (P25): the rules, the hash, the other sessions and the event. The session of the request stays: the
 * actor's account is the instance of the guard, and AuthenticateSession stores its new hash at the end of the request.
 */
final class ChangePassword
{
    use AsAction;

    /**
     * @param  array<string, mixed>  $input  `current_password`, `password`, `password_confirmation`
     *
     * @throws ValidationException
     */
    public function handle(Actor $actor, array $input): void
    {
        Authorize::check($actor, 'manageSignIn', User::class);
        $user = $actor->user;

        $valid = Validator::make($input, [
            'current_password' => ['bail', 'required', 'string', function (string $attribute, string $value, Closure $fail) use ($user): void {
                if (! Hash::check($value, (string) $user->password)) {
                    $fail(__('field.current_password.wrong'));
                }
            }],
            'password' => ['required', 'string', 'confirmed'],
        ], [
            'current_password' => __('field.current_password.wrong'),
            'password.confirmed' => __('field.password.confirmed'),
        ])->validate();

        SetPassword::run($user, $valid['password'], $actor, keepSession: true, reason: 'password_change');
    }
}
