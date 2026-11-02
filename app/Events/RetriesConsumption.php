<?php

namespace App\Events;

/**
 * An EventConsumer that implements this chooses the tries and the pause between them for its `ConsumeEvent` jobs
 * (otherwise `ConsumeEvent::TRIES` and `ConsumeEvent::BACKOFF` apply).
 */
interface RetriesConsumption
{
    public function tries(): int;

    /**
     * @return list<int> seconds before each retry
     */
    public function backoff(): array;
}
