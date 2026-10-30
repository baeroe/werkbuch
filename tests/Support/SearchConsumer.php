<?php

namespace Tests\Support;

use App\Events\EventConsumer;
use App\Models\Event;

/**
 * A consumer for tests that works in the queue `search`.
 */
final class SearchConsumer implements EventConsumer
{
    public function key(): string
    {
        return 'search';
    }

    public function queue(): string
    {
        return 'search';
    }

    public function consume(Event $event): void {}
}
