<?php

namespace App\Models;

use Carbon\CarbonImmutable;
use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Concerns\HasUlids;
use Illuminate\Database\Eloquent\Model;

/**
 * A line of the log of a run (spec 6.4, 7.5): what the CLI wrote, cut to the readable part by the runner. Not an event
 * of the outbox; at most 2 000 lines or 1 MB per run, kept 30 days (A481).
 *
 * @property string $id
 * @property string $run_id
 * @property int $attempt
 * @property string $kind
 * @property string $text
 * @property int $bytes
 * @property CarbonImmutable $at
 */
#[Fillable(['run_id', 'attempt', 'kind', 'text', 'bytes', 'at'])]
final class AgentRunEvent extends Model
{
    use HasUlids;

    public $timestamps = false;

    protected $dateFormat = 'Y-m-d H:i:s.u';

    public const KINDS = ['system', 'text', 'tool', 'result', 'error'];

    protected function casts(): array
    {
        return ['attempt' => 'integer', 'bytes' => 'integer', 'at' => 'immutable_datetime'];
    }
}
