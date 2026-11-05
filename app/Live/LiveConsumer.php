<?php

namespace App\Live;

use App\Events\EventConsumer;
use App\Events\EventType;
use App\Events\RetriesConsumption;
use App\Models\Event;
use Illuminate\Broadcasting\Channel;
use Illuminate\Broadcasting\PresenceChannel;
use Illuminate\Broadcasting\PrivateChannel;

/**
 * Tells the live channels what changed (queue `live`, A278; phase plan 8 "Live"), with IDs only (A279):
 *
 * | Event | Channel |
 * |---|---|
 * | `work_item.*` (not `subscribed`/`unsubscribed`), `project.*`, `page.*` (A318), `template.*`, `automation.updated` (A347) | `private-project.{project}` |
 * | `comment.*` (also the reactions) | `private-work-item.{item}` |
 * | `work_item.subscribed`/`unsubscribed` | `presence-user.{actor}` |
 * | `project.member_added` | also `presence-user.{new member}` (K14: the person does not listen to the project yet) |
 * | `user.role_changed` | `presence-user.{account}` (K14) |
 *
 * Every other event (catalogs, views, tokens, favorites, accounts, the events of the migrations) has no live update
 * (A280). Whoever lost access through the event is disconnected afterwards (A281, Disconnect). Broadcasts never throw
 * (A284): a Reverb that is down is reported, the event counts as taken and is not tried again (one try, no pause). A
 * second delivery of the event sends nothing: the outbox claims it once.
 */
final class LiveConsumer implements EventConsumer, RetriesConsumption
{
    public function key(): string
    {
        return 'live';
    }

    public function queue(): string
    {
        return 'live';
    }

    /** A late live update is worth nothing (A284): one try. */
    public function tries(): int
    {
        return 1;
    }

    /**
     * @return list<int>
     */
    public function backoff(): array
    {
        return [];
    }

    public function consume(Event $event): void
    {
        foreach (self::channels($event) as $channel) {
            Broadcasts::send(LiveMessage::of($event, $channel));
        }

        Disconnect::users(Disconnect::lostAccess($event));
    }

    /**
     * @return list<Channel>
     */
    private static function channels(Event $event): array
    {
        $project = $event->project_id === null ? [] : [new PrivateChannel("project.{$event->project_id}")];
        $user = fn (mixed $id): array => is_string($id) ? [new PresenceChannel("user.{$id}")] : [];

        return match (true) {
            $event->type === EventType::WorkItemSubscribed, $event->type === EventType::WorkItemUnsubscribed => $user($event->actor_id),
            $event->type === EventType::ProjectMemberAdded => [...$project, ...$user(data_get($event->changes, 'member.new.user_id'))],
            $event->type === EventType::UserRoleChanged => $user($event->subject_id),
            in_array($event->type->group(), ['work_item', 'project', 'page', 'template', 'automation'], true) => $project,
            $event->type->group() === 'comment' => [new PrivateChannel("work-item.{$event->subject_id}")],
            default => [],
        };
    }
}
