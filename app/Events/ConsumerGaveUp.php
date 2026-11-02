<?php

namespace App\Events;

use RuntimeException;
use Throwable;

/**
 * Reported when a consumer has used up its tries on an event.
 */
final class ConsumerGaveUp extends RuntimeException
{
    public function __construct(public readonly string $eventId, public readonly string $consumer, ?Throwable $previous = null)
    {
        parent::__construct("Consumer {$consumer} gave up on event {$eventId} after its last try; it waits in failed_jobs for queue:retry.", 0, $previous);
    }
}
