<?php

namespace App\Notifications;

use App\Actions\Notifications\NotifyRecipients;
use App\Events\EventConsumer;
use App\Events\RetriesConsumption;
use App\Models\Event;
use App\Models\User;
use App\Support\Actor;

/**
 * Turns the events of the outbox into notifications (queue `notifications`, spec 4.14, A39): it hands every event to
 * NotifyRecipients within the claim transaction and computes and writes nothing itself (ArchTest). A notification is
 * unique per person and event, so a retry or a second dispatch writes nothing twice. The events of the migrations and
 * of every other area pass without a notification.
 */
final class NotificationConsumer implements EventConsumer, RetriesConsumption
{
    public function key(): string
    {
        return 'notifications';
    }

    public function queue(): string
    {
        return 'notifications';
    }

    /**
     * 8 tries with 7 pauses (the last pause repeats), as SearchConsumer: about 3 h 20 min before the job ends in
     * failed_jobs and reports the event.
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
        NotifyRecipients::run(Actor::system(User::defaultBot(), 'notifications'), $event);
    }
}
