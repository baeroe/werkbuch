<?php

namespace App\Actions\Users;

use App\Access\Authorize;
use App\Access\LastAdmin;
use App\Access\Visibility;
use App\Actions\Auth\EndSessions;
use App\Events\EventRecorder;
use App\Events\EventType;
use App\Exceptions\Problem;
use App\Models\User;
use App\Support\Actor;
use Illuminate\Auth\Passwords\PasswordBroker;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Password;
use Lorisleiva\Actions\Concerns\AsAction;

/**
 * Deactivates an account instead of deleting it (spec 4.2, org admins): its tokens are revoked, its open reset links go
 * and its stored sessions end; a session elsewhere ends on its next request (EnsureAccountIsActive). History and
 * assignments stay. The default bot and the last active admin among the people stay active. An account deactivated
 * before keeps its time, and nothing happens to it: no event, no write.
 */
final class DeactivateUser
{
    use AsAction;

    /**
     * @throws Problem 409 `default_bot` or `last_admin`
     */
    public function handle(Actor $actor, User $user): User
    {
        Authorize::check($actor, 'deactivate', $user);

        if ($user->is_default_bot) {
            throw Problem::conflict('default_bot', detail: __('problem.detail.default_bot_deactivate'));
        }

        DB::transaction(function () use ($actor, $user): void {
            LastAdmin::guard($user);

            // after the admins (the lock order of LastAdmin): an account deactivated meanwhile stays as it is
            if (User::query()->whereKey($user->id)->lockForUpdate()->value('disabled_at') !== null) {
                $user->refresh();

                return;
            }

            $user->update(['disabled_at' => now()]);
            $user->tokens()->delete();
            // a link of "forgot password" sent before stops working (SetPassword refuses it as well)
            if ($user->email !== null) {
                /** @var PasswordBroker $broker */
                $broker = Password::broker(config('fortify.passwords'));
                $broker->deleteToken($user);
            }
            EndSessions::run($user);
            // a deactivated account sees nothing any more, already in this request
            Visibility::forget();
            EventRecorder::record(EventType::UserDeactivated, $actor, $user, null);
        });

        return $user;
    }
}
