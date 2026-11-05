<?php

namespace App\Models;

use App\Domain\Webhooks\EventPatterns;
use App\Events\EventType;
use Carbon\CarbonImmutable;
use Database\Factories\WebhookFactory;
use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Attributes\Hidden;
use Illuminate\Database\Eloquent\Concerns\HasUlids;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;
use Illuminate\Support\Carbon;

/**
 * A webhook (spec 6.3): a receiver (`url`) for the events of the catalog its patterns name (`events`, the normal form of
 * EventPatterns::normalize), of the organization (`project_id` null) or of one project, optionally only what a bot sees
 * (`bot_id`). The secret is stored encrypted with APP_KEY and never leaves the model by toArray() or toJson()
 * (spec 7.5). `active` is the switch of the admins; `disabled_at` says the system switched it off after 24 hours without
 * success, counted from `failing_since` (A366).
 *
 * @property string $id
 * @property string $name
 * @property string $url
 * @property string $secret
 * @property string|null $project_id
 * @property list<string> $events
 * @property string|null $bot_id
 * @property bool $active
 * @property CarbonImmutable|null $disabled_at
 * @property CarbonImmutable|null $failing_since
 * @property CarbonImmutable|null $last_success_at
 * @property string $created_by
 * @property Carbon|null $created_at
 * @property Carbon|null $updated_at
 * @property-read Project|null $project
 * @property-read User|null $bot
 * @property-read User $creator
 */
#[Fillable(['name', 'url', 'secret', 'project_id', 'events', 'bot_id', 'active', 'disabled_at', 'failing_since', 'last_success_at', 'created_by'])]
#[Hidden(['secret'])]
final class Webhook extends Model
{
    /** @use HasFactory<WebhookFactory> */
    use HasFactory, HasUlids;

    /** With microseconds: `failing_since` is timestamp(6); MariaDB cuts them off for the columns without. */
    protected $dateFormat = 'Y-m-d H:i:s.u';

    /**
     * A new secret (A369): `whsec_` and 32 random bytes as base64url without padding (43 characters).
     */
    public static function newSecret(): string
    {
        return 'whsec_'.rtrim(strtr(base64_encode(random_bytes(32)), '+/', '-_'), '=');
    }

    /**
     * The events a webhook can subscribe to: the values of the event types with a webhook, in the order of the enum.
     *
     * @return list<string>
     */
    public static function catalog(): array
    {
        $catalog = [];
        foreach (EventType::cases() as $type) {
            if ($type->webhook()) {
                $catalog[] = $type->value;
            }
        }

        return $catalog;
    }

    /** Whether its patterns name the event (never one outside the catalog). */
    public function matches(EventType $type): bool
    {
        return EventPatterns::matches($this->events, $type->value, self::catalog());
    }

    /**
     * @return BelongsTo<Project, $this>
     */
    public function project(): BelongsTo
    {
        return $this->belongsTo(Project::class);
    }

    /**
     * @return BelongsTo<User, $this>
     */
    public function bot(): BelongsTo
    {
        return $this->belongsTo(User::class, 'bot_id');
    }

    /**
     * @return BelongsTo<User, $this>
     */
    public function creator(): BelongsTo
    {
        return $this->belongsTo(User::class, 'created_by');
    }

    /**
     * @return HasMany<WebhookDelivery, $this>
     */
    public function deliveries(): HasMany
    {
        return $this->hasMany(WebhookDelivery::class);
    }

    /**
     * @return array<string, string>
     */
    protected function casts(): array
    {
        return [
            'secret' => 'encrypted',
            'events' => 'array',
            'active' => 'bool',
            'disabled_at' => 'immutable_datetime',
            'failing_since' => 'immutable_datetime',
            'last_success_at' => 'immutable_datetime',
        ];
    }
}
