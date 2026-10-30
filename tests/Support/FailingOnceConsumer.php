<?php

namespace Tests\Support;

use App\Events\EventConsumer;
use App\Models\Event;
use RuntimeException;

/**
 * A consumer for tests that throws on its first attempt and notes the event on every later one.
 */
final class FailingOnceConsumer implements EventConsumer
{
    public static int $attempts = 0;

    /** @var list<string> */
    public static array $seen = [];

    public function key(): string
    {
        return 'failing_once';
    }

    public function queue(): string
    {
        return 'default';
    }

    public function consume(Event $event): void
    {
        if (++self::$attempts === 1) {
            throw new RuntimeException('The first attempt fails.');
        }

        self::$seen[] = $event->id;
    }
}
