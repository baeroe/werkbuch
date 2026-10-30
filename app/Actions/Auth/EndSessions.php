<?php

namespace App\Actions\Auth;

use App\Models\User;
use Illuminate\Support\Facades\DB;
use Lorisleiva\Actions\Concerns\AsAction;

/**
 * Ends the stored sessions of an account, except the one it names (P8). Only the session driver `database` keeps them
 * where they can be found by account; for every other driver AuthenticateSession (password changed) and
 * EnsureAccountIsActive (account disabled) end a session on its next request.
 */
final class EndSessions
{
    use AsAction;

    public function handle(User $user, ?string $except = null): void
    {
        if (config('session.driver') !== 'database') {
            return;
        }

        // the sessions live on the connection the session store uses, not necessarily the default one
        DB::connection(config('session.connection'))->table((string) config('session.table'))
            ->where('user_id', $user->id)
            ->when($except !== null, fn ($query) => $query->where('id', '!=', $except))
            ->delete();
    }
}
