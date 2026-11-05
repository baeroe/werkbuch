<?php

namespace App\Models;

use Carbon\CarbonImmutable;
use Database\Factories\WebhookDeliveryFactory;
use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Concerns\HasUlids;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;
use Illuminate\Support\Carbon;

/**
 * One event for one webhook, or a ping (`event_id` null, `event` `ping`): the JSON body as it goes out on every attempt
 * (A362) and how far it got. Its ULID is the header `X-Werkbuch-Delivery`, the same over all attempts and "send again".
 * `attempts` is the number of attempts so far (the column); the log of them is the relation, read only as `attempts()`.
 *
 * @property string $id
 * @property string $webhook_id
 * @property string|null $event_id
 * @property string $event
 * @property string $body
 * @property string $status
 * @property int $attempts
 * @property CarbonImmutable|null $created_at
 * @property Carbon|null $updated_at
 * @property-read Webhook $webhook
 */
#[Fillable(['webhook_id', 'event_id', 'event', 'body', 'status', 'attempts'])]
final class WebhookDelivery extends Model
{
    /** @use HasFactory<WebhookDeliveryFactory> */
    use HasFactory, HasUlids;

    /** Waits for its first or next attempt. */
    public const PENDING = 'pending';

    /** A receiver answered with 2xx. */
    public const SUCCEEDED = 'succeeded';

    /** All tries failed. */
    public const FAILED = 'failed';

    /** Stopped without sending: the webhook went off or its bot lost access. */
    public const CANCELLED = 'cancelled';

    public const STATUSES = [self::PENDING, self::SUCCEEDED, self::FAILED, self::CANCELLED];

    /** With microseconds: `created_at` is timestamp(6); MariaDB cuts them off for `updated_at`. */
    protected $dateFormat = 'Y-m-d H:i:s.u';

    /**
     * @return BelongsTo<Webhook, $this>
     */
    public function webhook(): BelongsTo
    {
        return $this->belongsTo(Webhook::class);
    }

    /**
     * Its attempts in order.
     *
     * @return HasMany<WebhookAttempt, $this>
     */
    public function attempts(): HasMany
    {
        return $this->hasMany(WebhookAttempt::class, 'delivery_id')->orderBy('attempt')->orderBy('id');
    }

    /**
     * @return array<string, string>
     */
    protected function casts(): array
    {
        return [
            'attempts' => 'int',
            'created_at' => 'immutable_datetime',
        ];
    }
}
