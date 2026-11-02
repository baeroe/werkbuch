<?php

namespace App\Jobs;

use App\Events\ConsumerGaveUp;
use App\Events\EventConsumer;
use App\Events\Outbox;
use App\Events\RetriesConsumption;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Foundation\Queue\Queueable;
use Throwable;

/**
 * One consumer takes one event; the outbox puts it in the consumer's queue.
 */
final class ConsumeEvent implements ShouldQueue
{
    use Queueable;

    public const TRIES = 5;

    /** @var list<int> */
    public const BACKOFF = [10, 60, 300];

    /**
     * @param  string  $consumer  class of an App\Events\EventConsumer
     */
    public function __construct(public string $eventId, public string $consumer) {}

    public function tries(): int
    {
        return $this->consumerInstance() instanceof RetriesConsumption ? $this->consumerInstance()->tries() : self::TRIES;
    }

    /**
     * @return list<int>
     */
    public function backoff(): array
    {
        return $this->consumerInstance() instanceof RetriesConsumption ? $this->consumerInstance()->backoff() : self::BACKOFF;
    }

    public function failed(?Throwable $exception): void
    {
        report(new ConsumerGaveUp($this->eventId, $this->consumer, $exception));
    }

    private function consumerInstance(): EventConsumer
    {
        return app($this->consumer);
    }

    public function handle(Outbox $outbox): void
    {
        $outbox->consume($this->eventId, $this->consumer);
    }
}
