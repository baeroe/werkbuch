<?php

namespace Tests\Support;

use App\Events\EventConsumer;
use App\Events\RetriesConsumption;
use App\Models\Event;

/**
 * A consumer for tests that picks its own tries and pause, in the queue `search`.
 */
final class PatientConsumer implements EventConsumer, RetriesConsumption
{
    public function key(): string
    {
        return 'patient';
    }

    public function queue(): string
    {
        return 'search';
    }

    public function consume(Event $event): void {}

    public function tries(): int
    {
        return 8;
    }

    public function backoff(): array
    {
        return [10, 60, 300, 900, 3600];
    }
}
