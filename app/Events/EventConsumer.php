<?php

namespace App\Events;

use App\Models\Event;

/**
 * Receives every domain event once, after the commit, in its own queue (config `werkbuch.event_consumers`). The outbox
 * keeps it idempotent per event: `consume()` runs inside the transaction that claims the row in `event_consumptions`.
 *
 * Rules for `consume()`: only database writes and external effects that are idempotent themselves. A failure rolls the
 * claim back and the job runs again, so a mail or a webhook call made here could go out twice: non-idempotent effects
 * (mail, webhook HTTP) go into jobs of their own, with their own dedupe row, dispatched `->afterCommit()`. A consumer that
 * uses up its tries ends in `failed_jobs`; `queue:retry` runs it again, app:redispatch-events does not (the event counts
 * as dispatched).
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
