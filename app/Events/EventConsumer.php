<?php

namespace App\Events;

use App\Models\Event;

/**
 * Receives every domain event once, after the commit, in its own queue (config `werkbuch.event_consumers`). The outbox
 * keeps it idempotent per event: `consume()` runs inside the transaction that claims the row in `event_consumptions`.
 */
interface EventConsumer
{
    /**
     * Stable name of the consumer in `event_consumptions.consumer`, at most 120 characters.
     */
    public function key(): string;

    /**
     * The queue its jobs run in (`default`, `notifications`, `webhooks`, `search`, `media`, `bulk`).
     */
    public function queue(): string;

    public function consume(Event $event): void;
}
