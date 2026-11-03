<?php

namespace App\Live;

use App\Models\Event;
use Illuminate\Broadcasting\Channel;
use Illuminate\Broadcasting\PresenceChannel;
use Illuminate\Contracts\Broadcasting\ShouldBroadcastNow;

/**
 * One message on one live channel (phase plan 8 "Live"), sent at once (ShouldBroadcastNow, through Broadcasts) under
 * the name `live`. It carries IDs and the type only, never a title, a text or a value (A279): the browser reads again
 * through the API, which checks the right to read. `$socket` is the tab that made the change: Reverb leaves it out
 * (A282).
 */
final class LiveMessage implements ShouldBroadcastNow
{
    /**
     * @param  array<string, mixed>  $payload
     */
    public function __construct(
        private readonly Channel $channel,
        private readonly array $payload,
        public readonly ?string $socket = null,
    ) {}

    /**
     * What an event says on a channel: `{event_id, type, project_id, item_id, comment_id, actor_id}`, missing ones as
     * `null`. The item is the subject of `work_item.*` and `comment.*` (A227), the comment stands in their meta.
     */
    public static function of(Event $event, Channel $channel): self
    {
        $item = in_array($event->type->group(), ['work_item', 'comment'], true) ? $event->subject_id : null;
        $comment = $event->meta['comment_id'] ?? null;
        $socket = $event->meta['socket'] ?? null;

        return new self($channel, [
            'event_id' => $event->id,
            'type' => $event->type->value,
            'project_id' => $event->project_id,
            'item_id' => $item,
            'comment_id' => is_string($comment) ? $comment : null,
            'actor_id' => $event->actor_id,
        ], is_string($socket) ? $socket : null);
    }

    /**
     * The badge and the inbox of the person load again (`notifications.changed`, no event behind it).
     */
    public static function notificationsChanged(string $userId, ?string $socket): self
    {
        return new self(new PresenceChannel("user.{$userId}"), [
            'event_id' => null,
            'type' => 'notifications.changed',
            'project_id' => null,
            'item_id' => null,
            'comment_id' => null,
            'actor_id' => null,
            'unread_changed' => true,
        ], $socket);
    }

    public function broadcastOn(): Channel
    {
        return $this->channel;
    }

    public function broadcastAs(): string
    {
        return 'live';
    }

    /**
     * @return array<string, mixed>
     */
    public function broadcastWith(): array
    {
        return $this->payload;
    }
}
