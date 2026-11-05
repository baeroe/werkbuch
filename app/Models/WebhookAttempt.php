<?php

namespace App\Models;

use Carbon\CarbonImmutable;
use Database\Factories\WebhookAttemptFactory;
use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Concerns\HasUlids;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/**
 * One call of the receiver of a delivery, the log of webhooks: the answer (`status_code`, the first 2 KB of the body) or,
 * without one, why (`error`), how long it took and when. `kind` says who sent it: the schedule of retries, "send again"
 * or a ping. It carries `webhook_id` so the log of a webhook needs no join.
 *
 * @property string $id
 * @property string $delivery_id
 * @property string $webhook_id
 * @property int $attempt
 * @property string $kind
 * @property int|null $status_code
 * @property int $duration_ms
 * @property string|null $response_excerpt
 * @property string|null $error
 * @property CarbonImmutable $attempted_at
 * @property-read WebhookDelivery $delivery
 */
#[Fillable(['delivery_id', 'webhook_id', 'attempt', 'kind', 'status_code', 'duration_ms', 'response_excerpt', 'error', 'attempted_at'])]
final class WebhookAttempt extends Model
{
    /** @use HasFactory<WebhookAttemptFactory> */
    use HasFactory, HasUlids;

    /** One of the tries of the schedule (Backoff). */
    public const SCHEDULED = 'scheduled';

    /** "Send again" of an admin. */
    public const MANUAL = 'manual';

    /** The test ping of an admin. */
    public const PING = 'ping';

    public const KINDS = [self::SCHEDULED, self::MANUAL, self::PING];

    public $timestamps = false;

    /** With microseconds: `attempted_at` is timestamp(6). */
    protected $dateFormat = 'Y-m-d H:i:s.u';

    /**
     * @return BelongsTo<WebhookDelivery, $this>
     */
    public function delivery(): BelongsTo
    {
        return $this->belongsTo(WebhookDelivery::class, 'delivery_id');
    }

    /**
     * @return array<string, string>
     */
    protected function casts(): array
    {
        return [
            'attempt' => 'int',
            'status_code' => 'int',
            'duration_ms' => 'int',
            'attempted_at' => 'immutable_datetime',
        ];
    }
}
