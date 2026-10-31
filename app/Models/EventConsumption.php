<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Concerns\HasUlids;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Support\Carbon;

/**
 * A consumer has taken an event (App\Events\Outbox::consume); unique per event and consumer.
 *
 * @property string $id
 * @property string $event_id
 * @property string $consumer
 * @property Carbon $consumed_at
 * @property Carbon|null $created_at
 * @property Carbon|null $updated_at
 */
final class EventConsumption extends Model
{
    use HasUlids;

    /**
     * @return array<string, string>
     */
    protected function casts(): array
    {
        return [
            'consumed_at' => 'datetime',
        ];
    }
}
