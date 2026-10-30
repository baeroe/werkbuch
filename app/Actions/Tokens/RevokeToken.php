<?php

namespace App\Actions\Tokens;

use App\Access\Authorize;
use App\Events\EventRecorder;
use App\Events\EventType;
use App\Models\PersonalAccessToken;
use App\Models\User;
use App\Support\Actor;
use Illuminate\Support\Facades\DB;
use Lorisleiva\Actions\Concerns\AsAction;

/**
 * Revokes a token: it is deleted, its next request gets 401. The event keeps its ID.
 */
final class RevokeToken
{
    use AsAction;

    public function handle(Actor $actor, PersonalAccessToken $token): void
    {
        Authorize::check($actor, 'manageTokens', User::query()->findOrFail($token->tokenable_id));

        DB::transaction(function () use ($actor, $token): void {
            EventRecorder::record(EventType::TokenRevoked, $actor, $token, null);
            $token->delete();
        });
    }
}
