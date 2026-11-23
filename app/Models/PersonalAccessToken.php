<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Concerns\HasUlids;
use Laravel\Sanctum\PersonalAccessToken as SanctumToken;

/**
 * Sanctum's token with a ULID key (P3); the plain text reads `<id>|wb_<secret>`. A run token (spec 11.2) names its run
 * in `agent_run_id`: it lives as long as the run, is never listed with the tokens of the bot and is locked hard
 * (RunTokenGuard).
 *
 * @property string|null $agent_run_id
 */
final class PersonalAccessToken extends SanctumToken
{
    use HasUlids;
}
