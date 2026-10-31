<?php

namespace App\Actions\Users;

use App\Access\Authorize;
use App\Access\Visibility;
use App\Events\EventRecorder;
use App\Events\EventType;
use App\Models\User;
use App\Support\Actor;
use Illuminate\Support\Facades\DB;
use Lorisleiva\Actions\Concerns\AsAction;

/**
 * Activates a deactivated account again (org admins). Its old tokens stay revoked; it signs in anew. An active account
 * stays as it is: no event, no write.
 */
final class ReactivateUser
{
    use AsAction;

    public function handle(Actor $actor, User $user): User
    {
        Authorize::check($actor, 'reactivate', $user);

        DB::transaction(function () use ($actor, $user): void {
            if (User::query()->whereKey($user->id)->lockForUpdate()->value('disabled_at') === null) {
                $user->refresh();

                return;
            }

            $user->update(['disabled_at' => null]);
            Visibility::forget();
            EventRecorder::record(EventType::UserReactivated, $actor, $user, null);
        });

        return $user;
    }
}
