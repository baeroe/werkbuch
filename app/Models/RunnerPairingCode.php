<?php

namespace App\Models;

use Carbon\CarbonImmutable;
use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Attributes\Hidden;
use Illuminate\Database\Eloquent\Concerns\HasUlids;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/**
 * A one-time code to pair a runner (spec 6.2, A473): ten minutes, redeemed once; only its hash is stored, the code
 * itself is in the answer of creating it. A new code makes the ones not redeemed yet stop working.
 *
 * @property string $id
 * @property string $code_hash
 * @property CarbonImmutable $expires_at
 * @property CarbonImmutable|null $redeemed_at
 * @property string|null $runner_id
 * @property string $created_by
 * @property CarbonImmutable|null $created_at
 * @property-read Runner|null $runner
 */
#[Fillable(['code_hash', 'expires_at', 'redeemed_at', 'runner_id', 'created_by', 'created_at'])]
#[Hidden(['code_hash'])]
final class RunnerPairingCode extends Model
{
    use HasUlids;

    public const UPDATED_AT = null;

    /** How long a code holds. */
    public const MINUTES = 10;

    /** Letters and digits that cannot be mistaken for each other (no I, O, 0, 1). */
    public const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

    /** The pattern of a code as people type it: two groups of four, case and the dash optional. */
    public const PATTERN = '/^[A-HJ-NP-Z2-9]{4}-?[A-HJ-NP-Z2-9]{4}\z/';

    protected function casts(): array
    {
        return [
            'expires_at' => 'immutable_datetime',
            'redeemed_at' => 'immutable_datetime',
            'created_at' => 'immutable_datetime',
        ];
    }

    /** A new code `XXXX-XXXX` of 32 characters each (40 bits). */
    public static function newCode(): string
    {
        $pick = fn () => implode('', array_map(fn () => self::ALPHABET[random_int(0, strlen(self::ALPHABET) - 1)], range(1, 4)));

        return $pick().'-'.$pick();
    }

    /** The hash of a code in any case, with or without the dash; null when it cannot be a code. */
    public static function hashCode(string $code): ?string
    {
        $upper = strtoupper(trim($code));

        return preg_match(self::PATTERN, $upper) === 1 ? hash('sha256', str_replace('-', '', $upper)) : null;
    }

    /** @return BelongsTo<Runner, $this> */
    public function runner(): BelongsTo
    {
        return $this->belongsTo(Runner::class);
    }
}
