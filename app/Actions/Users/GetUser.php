<?php

namespace App\Actions\Users;

use App\Models\User;
use App\Support\Actor;
use Lorisleiva\Actions\Concerns\AsAction;

/**
 * One account, as the list shows it: every active account reads every account, deactivated ones included (A392). The
 * route binds it by ULID in any case.
 */
final class GetUser
{
    use AsAction;

    public function handle(Actor $actor, User $user): User
    {
        return $user->load('media');
    }
}
