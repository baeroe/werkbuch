<?php

namespace App\Actions\Auth;

use App\Events\EventRecorder;
use App\Events\EventType;
use App\Models\User;
use App\Support\Actor;
use App\Support\PasswordRules;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Validator;
use Illuminate\Support\Str;
use Illuminate\Validation\ValidationException;
use Lorisleiva\Actions\Concerns\AsAction;

/**
 * The one place that sets a password (P25): checks the rules, stores the hash, renews the remember token, ends the
 * sessions of the account and notes `user.password_changed`. Sessions under other drivers end on their next request
 * (AuthenticateSession sees the new hash).
 */
final class SetPassword
{
    use AsAction;

    /**
     * @param  Actor|null  $actor  who changes it; without one the system does, for the account
     * @param  bool  $keepSession  keeps the session of the running request (the person changed the password there)
     * @param  string  $reason  why (`password_reset`, `password_change`, …), the `meta.reason` of the event
     *
     * @throws ValidationException when the password breaks the rules; nothing changes then
     */
    public function handle(User $user, #[\SensitiveParameter] string $password, ?Actor $actor = null, bool $keepSession = false, string $reason = 'password_reset'): void
    {
        Validator::make(['password' => $password], ['password' => PasswordRules::rules()])->validate();

        DB::transaction(function () use ($user, $password, $actor, $keepSession, $reason): void {
            $user->forceFill(['password' => $password, 'remember_token' => Str::random(60)])->save();
            EndSessions::run($user, $keepSession ? session()->getId() : null);
            // the event names why in `meta.reason`, also when an account acts
            $actor = $actor === null ? Actor::system($user, $reason) : new Actor($actor->user, $actor->via, $reason, $actor->token);
            EventRecorder::record(EventType::UserPasswordChanged, $actor, $user, null);
        });
    }
}
