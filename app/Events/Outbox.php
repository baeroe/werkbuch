<?php

namespace App\Events;

use App\Jobs\ConsumeEvent;
use App\Jobs\DispatchEvent;
use App\Models\Event;
use App\Models\EventConsumption;
use Illuminate\Database\UniqueConstraintViolationException;
use Illuminate\Support\Facades\Config;
use Illuminate\Support\Facades\DB;
use RuntimeException;

/**
 * Hands recorded events on to the consumers of `werkbuch.event_consumers`. Every step may run more than once (a late
 * job next to a redispatch, a retry): the row per event and consumer in `event_consumptions` lets each consumer act once.
 */
final class Outbox
{
    /** Minutes after which an event that was never dispatched counts as lost. */
    public const STALE_MINUTES = 2;

    /** Minutes a redispatched event waits before the next redispatch (a queue that is down or full gets no storm). */
    public const REDISPATCH_PAUSE_MINUTES = 15;

    /** Minutes after which an event that is still not dispatched is reported. */
    public const REPORT_MINUTES = 60;

    /** Events per run of the redispatcher. */
    public const REDISPATCH_BATCH = 500;

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
     * throws leaves no row behind, so its retry runs it again; a second claim waits for the first and then hits the
     * unique key.
     *
     * @return bool whether the consumer ran
     */
    public function consume(string $eventId, string $consumerClass): bool
    {
        $consumer = $this->consumer($consumerClass);

        return DB::transaction(function () use ($eventId, $consumer): bool {
            $now = now();

            // only the unique key means "taken already"; any other error (unknown event, too long a key) fails loudly
            try {
                EventConsumption::query()->insert([
                    'id' => (new EventConsumption)->newUniqueId(),
                    'event_id' => $eventId,
                    'consumer' => $consumer->key(),
                    'consumed_at' => $now,
                    'created_at' => $now,
                    'updated_at' => $now,
                ]);
            } catch (UniqueConstraintViolationException) {
                return false;
            }

            $consumer->consume(Event::query()->findOrFail($eventId));

            return true;
        });
    }

    /**
     * Dispatches again the events whose dispatch has not run within STALE_MINUTES (the process died between commit and
     * dispatch, or the job was lost), at most REDISPATCH_BATCH per run, each at most once per REDISPATCH_PAUSE_MINUTES.
     * An event still not dispatched after REPORT_MINUTES is reported on every redispatch.
     *
     * @return int how many events were dispatched again
     */
    public function redispatchStale(): int
    {
        $now = now();
        $events = Event::query()
            ->whereNull('dispatched_at')
            ->where('occurred_at', '<', $now->copy()->subMinutes(self::STALE_MINUTES))
            ->where(fn ($query) => $query->whereNull('redispatched_at')
                ->orWhere('redispatched_at', '<', $now->copy()->subMinutes(self::REDISPATCH_PAUSE_MINUTES)))
            ->orderBy('occurred_at')
            ->limit(self::REDISPATCH_BATCH)
            ->get(['id', 'occurred_at']);

        Event::query()->whereKey($events->modelKeys())->update(['redispatched_at' => $now]);

        foreach ($events as $event) {
            if ($event->occurred_at->lt($now->copy()->subMinutes(self::REPORT_MINUTES))) {
                report(new RuntimeException("Event {$event->id} is still not dispatched after ".self::REPORT_MINUTES.' minutes.'));
            }

            DispatchEvent::dispatch($event->id);
        }

        return $events->count();
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
