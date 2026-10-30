<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Concerns\HasUlids;
use Laravel\Sanctum\PersonalAccessToken as SanctumToken;

/**
 * Sanctum's token with a ULID key (P3); the plain text reads `<id>|wb_<secret>`.
 */
final class PersonalAccessToken extends SanctumToken
{
    use HasUlids;
}
