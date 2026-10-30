<?php

namespace Tests\Support;

use App\Events\EventConsumer;
use App\Models\Event;

/**
 * A consumer for tests: notes the id of every event it receives.
 */
final class RecordingConsumer implements EventConsumer
{
    /** @var list<string> */
    public static array $seen = [];

    public function key(): string
    {
        return 'recording';
    }

    public function queue(): string
    {
        return 'default';
    }

    public function consume(Event $event): void
    {
        self::$seen[] = $event->id;
    }
}
