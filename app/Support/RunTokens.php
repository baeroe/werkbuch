<?php

namespace App\Support;

use App\Domain\Agents\Protocol;
use App\Models\AgentRun;
use App\Models\PersonalAccessToken;

/**
 * The token of a run (spec 11.2, A477): a personal access token of the agent bot with the abilities of the kind of run,
 * living as long as the time limit and a grace, marked with the run (`agent_run_id`). A claim issues it (a new attempt a
 * new one), the end of the run revokes it. No event: a run token is never in the history; its plain text is only in the
 * answer of the claim.
 */
final class RunTokens
{
    public static function issue(AgentRun $run): string
    {
        self::revoke($run);

        $token = $run->bot->createToken(
            "run {$run->id}",
            $run->type->abilities(),
            now()->addMinutes($run->type->timeoutMinutes() + Protocol::TOKEN_GRACE_MINUTES),
        );
        $token->accessToken->forceFill(['agent_run_id' => $run->id])->save();

        return $token->plainTextToken;
    }

    public static function revoke(AgentRun $run): void
    {
        PersonalAccessToken::query()->where('agent_run_id', $run->id)->delete();
    }
}
