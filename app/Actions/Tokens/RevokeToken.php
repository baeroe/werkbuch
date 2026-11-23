<?php

namespace App\Actions\Tokens;

use App\Access\Authorize;
use App\Events\EventRecorder;
use App\Events\EventType;
use App\Exceptions\Problem;
use App\Models\PersonalAccessToken;
use App\Models\User;
use App\Support\Actor;
use Illuminate\Support\Facades\DB;
use Lorisleiva\Actions\Concerns\AsAction;

/**
 * Revokes a token: it is deleted, its next request gets 401. The event keeps its ID. A token of an account whose tokens
 * the actor may not manage is 404, like anything the actor may not see.
 */
final class RevokeToken
{
    use AsAction;

    public function handle(Actor $actor, PersonalAccessToken $token): void
    {
        // the token of a run is no token of the list: it ends with its run (spec 11.2)
        if ($token->agent_run_id !== null) {
            throw Problem::notFound();
        }

        Authorize::check($actor, 'revokeToken', User::query()->findOrFail($token->tokenable_id));

        DB::transaction(function () use ($actor, $token): void {
            EventRecorder::record(EventType::TokenRevoked, $actor, $token, null);
            $token->delete();
        });
    }
}
