<?php

namespace App\Webhooks;

use App\Actions\Webhooks\QueueDeliveries;
use App\Events\EventConsumer;
use App\Events\RetriesConsumption;
use App\Models\Event;
use App\Models\User;
use App\Support\Actor;

/**
 * Turns the events of the outbox into webhook deliveries (queue `webhooks`, spec 6.3, A39): it hands every event to
 * QueueDeliveries within the claim transaction and computes and writes nothing itself (ArchTest). Only rows are
 * written there; the HTTP of a delivery is a job of its own, queued after the commit, so a retry or a second dispatch
 * sends nothing twice. The events of the migrations and every event without a webhook pass without a delivery.
 */
final class WebhookConsumer implements EventConsumer, RetriesConsumption
{
    public function key(): string
    {
        return 'webhooks';
    }

    public function queue(): string
    {
        return 'webhooks';
    }

    /**
     * 8 tries with 7 pauses (the last pause repeats), as SearchConsumer and NotificationConsumer: about 3 h 20 min
     * before the job ends in failed_jobs and reports the event.
     */
    public function tries(): int
    {
        return 8;
    }

    /**
     * @return list<int>
     */
    public function backoff(): array
    {
        return [10, 60, 300, 900, 3600];
    }

    public function consume(Event $event): void
    {
        QueueDeliveries::run(Actor::system(User::defaultBot(), 'webhooks'), $event);
    }
}
