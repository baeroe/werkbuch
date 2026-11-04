<?php

namespace App\Live;

use App\Events\EventType;
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
     * The most pages a `page.deleted` names in `page_ids` (T6-M3): Reverb takes a request of 10 000 bytes at most
     * (`max_request_size`, with the request line and the headers), and each ID costs 31 bytes in the escaped `data`.
     * 200 IDs stay near 6 500 bytes; the browser remembers as many deleted IDs (`GONE_MAX` in `hooks/live.ts`).
     */
    public const PAGE_IDS_MAX = 200;

    /**
     * @param  array<string, mixed>  $payload
     */
    public function __construct(
        private readonly Channel $channel,
        private readonly array $payload,
        public readonly ?string $socket = null,
    ) {}

    /**
     * What an event says on a channel: `{event_id, type, project_id, page_id, item_id, comment_id, actor_id}`, missing
     * ones as `null`. The item is the subject of `work_item.*` and `comment.*` (A227), the comment stands in their meta,
     * the page is the subject of `page.*` (A318). `page.deleted` adds `page_ids`, the whole subtree from `meta.page_ids`
     * (the root first); a subtree of more than PAGE_IDS_MAX pages is too large to name and comes as `null`: the browser
     * loads the tree again and takes what is no longer in it as gone.
     */
    public static function of(Event $event, Channel $channel): self
    {
        $group = $event->type->group();
        $item = in_array($group, ['work_item', 'comment'], true) ? $event->subject_id : null;
        $comment = $event->meta['comment_id'] ?? null;
        $socket = $event->meta['socket'] ?? null;

        $payload = [
            'event_id' => $event->id,
            'type' => $event->type->value,
            'project_id' => $event->project_id,
            'page_id' => $group === 'page' ? $event->subject_id : null,
            'item_id' => $item,
            'comment_id' => is_string($comment) ? $comment : null,
            'actor_id' => $event->actor_id,
        ];
        if ($event->type === EventType::PageDeleted) {
            $ids = array_values(array_filter((array) ($event->meta['page_ids'] ?? []), 'is_string'));
            $payload['page_ids'] = count($ids) > self::PAGE_IDS_MAX ? null : $ids;
        }

        return new self($channel, $payload, is_string($socket) ? $socket : null);
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
            'page_id' => null,
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
