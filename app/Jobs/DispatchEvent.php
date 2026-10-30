<?php

namespace App\Jobs;

use App\Events\Outbox;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Foundation\Queue\Queueable;

/**
 * Starts after the commit of the action that recorded the event (and again from app:redispatch-events).
 */
final class DispatchEvent implements ShouldQueue
{
    use Queueable;

    public int $tries = 5;

    /** @var list<int> */
    public array $backoff = [10, 60, 300];

    public function __construct(public string $eventId)
    {
        $this->onQueue('default');
    }

    public function handle(Outbox $outbox): void
    {
        $outbox->dispatch($this->eventId);
    }
}
