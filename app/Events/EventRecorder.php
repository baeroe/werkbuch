<?php

namespace App\Events;

use App\Jobs\DispatchEvent;
use App\Models\Event;
use App\Models\Project;
use App\Support\Actor;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Support\Facades\DB;
use LogicException;

/**
 * The one way to write an event: inside the transaction of an action (outbox), so the event exists exactly when the
 * change does. Its dispatch starts after the commit; App\Events\Outbox::redispatchStale() catches a dispatch that was lost.
 */
final class EventRecorder
{
    /**
     * @param  array<string, array{old: mixed, new: mixed}>|null  $changes  `{field: {old, new}}`
     * @param  array<string, mixed>  $meta  more about the event; `via`, `reason` and `token_id` come from the actor
     *
     * @throws LogicException outside a transaction
     */
    public static function record(EventType|string $type, Actor $actor, Model $subject, ?Project $project, ?array $changes = null, array $meta = []): Event
    {
        if (DB::transactionLevel() === 0) {
            throw new LogicException('Events are recorded inside the transaction of an action.');
        }

        $event = Event::query()->create([
            'type' => $type instanceof EventType ? $type : EventType::from($type),
            'actor_id' => $actor->user->id,
            'subject_type' => $subject->getMorphClass(),
            'subject_id' => $subject->getKey(),
            'project_id' => $project?->id,
            'changes' => $changes,
            'meta' => $actor->meta() + $meta,
            'occurred_at' => now(),
        ]);

        DispatchEvent::dispatch($event->id)->afterCommit();

        return $event;
    }
}
