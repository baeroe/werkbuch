<?php

namespace App\Jobs;

use App\Events\Outbox;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Foundation\Queue\Queueable;

/**
 * One consumer takes one event; the outbox puts it in the consumer's queue.
 */
final class ConsumeEvent implements ShouldQueue
{
    use Queueable;

    public int $tries = 5;

    /** @var list<int> */
    public array $backoff = [10, 60, 300];

    /**
     * @param  string  $consumer  class of an App\Events\EventConsumer
     */
    public function __construct(public string $eventId, public string $consumer) {}

    public function handle(Outbox $outbox): void
    {
        $outbox->consume($this->eventId, $this->consumer);
    }
}
