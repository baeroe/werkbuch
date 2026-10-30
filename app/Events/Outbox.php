<?php

namespace App\Events;

use App\Jobs\ConsumeEvent;
use App\Jobs\DispatchEvent;
use App\Models\Event;
use App\Models\EventConsumption;
use Illuminate\Support\Facades\Config;
use Illuminate\Support\Facades\DB;

/**
 * Hands recorded events on to the consumers of `werkbuch.event_consumers`. Every step may run more than once (a late
 * job next to a redispatch, a retry): the row per event and consumer in `event_consumptions` lets each consumer act once.
 */
final class Outbox
{
    /** Minutes after which an event that was never dispatched counts as lost. */
    public const STALE_MINUTES = 2;

    /**
     * One ConsumeEvent per consumer, in the consumer's queue; then the event counts as dispatched (the first time only).
     */
    public function dispatch(string $eventId): void
    {
        foreach ($this->consumerClasses() as $class) {
            ConsumeEvent::dispatch($eventId, $class)->onQueue($this->consumer($class)->queue());
        }

        Event::query()->whereKey($eventId)->whereNull('dispatched_at')->update(['dispatched_at' => now()]);
    }

    /**
     * Runs the consumer for the event unless it already took it. Claim and work share one transaction: a consumer that
     * throws leaves no row behind, so its retry runs it again; a second claim waits for the first and then finds the row.
     *
     * @return bool whether the consumer ran
     */
    public function consume(string $eventId, string $consumerClass): bool
    {
        $consumer = $this->consumer($consumerClass);

        return DB::transaction(function () use ($eventId, $consumer): bool {
            $now = now();
            $claimed = EventConsumption::query()->insertOrIgnore([
                'id' => (new EventConsumption)->newUniqueId(),
                'event_id' => $eventId,
                'consumer' => $consumer->key(),
                'consumed_at' => $now,
                'created_at' => $now,
                'updated_at' => $now,
            ]);

            if ($claimed === 0) {
                return false;
            }

            $consumer->consume(Event::query()->findOrFail($eventId));

            return true;
        });
    }

    /**
     * Dispatches again every event whose dispatch has not run within STALE_MINUTES (the process died between commit and
     * dispatch, or the job was lost).
     *
     * @return int how many events were dispatched again
     */
    public function redispatchStale(): int
    {
        $ids = Event::query()->whereNull('dispatched_at')->where('occurred_at', '<', now()->subMinutes(self::STALE_MINUTES))
            ->orderBy('occurred_at')->pluck('id');

        foreach ($ids as $id) {
            DispatchEvent::dispatch($id);
        }

        return $ids->count();
    }

    /**
     * @return list<string>
     */
    private function consumerClasses(): array
    {
        /** @var list<string> */
        return Config::array('werkbuch.event_consumers');
    }

    private function consumer(string $class): EventConsumer
    {
        /** @var EventConsumer */
        return app($class);
    }
}
