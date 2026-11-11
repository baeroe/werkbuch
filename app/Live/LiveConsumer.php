<?php

namespace App\Live;

use App\Access\Visibility;
use App\Enums\AccountType;
use App\Enums\ProjectVisibility;
use App\Events\EventConsumer;
use App\Events\EventType;
use App\Events\RetriesConsumption;
use App\Models\Event;
use App\Models\Project;
use App\Models\User;
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
 * | `project.created`, `project.updated` that made it public | also `presence-user.{everyone who sees it}` (A451) |
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
        foreach (array_chunk(self::newcomers($event), LiveMessage::CHANNELS_MAX) as $channels) {
            Broadcasts::send(LiveMessage::of($event, ...$channels));
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

    /**
     * The own channels of the people who see a project but do not listen to it yet (A451): nobody holds the channel of
     * a new project, and that of a project that turned public only its members and the org admins. Every active person
     * whom Visibility lets see the project now, the actor too: Reverb leaves out the tab of the socket (A282), the
     * actor's other tabs (and every tab, when the change came over a token) hear it. A private project reaches its
     * members and the org admins, one being deleted (or gone) nobody. Members who hold the project channel
     * hear it twice; the browser keeps one per `event_id`. Asks the same queries however many people there are (the
     * project, the people, the org roles and the members, the last two only for a private project).
     *
     * @return list<PresenceChannel>
     */
    private static function newcomers(Event $event): array
    {
        $shown = $event->type === EventType::ProjectCreated
            || ($event->type === EventType::ProjectUpdated && data_get($event->changes, 'visibility.new') === ProjectVisibility::Public->value);
        $project = $shown ? Project::query()->find($event->subject_id) : null;
        if ($project === null) {
            return [];
        }

        Visibility::forget();
        $people = User::query()->where('type', AccountType::Person)->whereNull('disabled_at')->orderBy('id')->get();

        return array_map(fn (User $user) => new PresenceChannel("user.{$user->id}"), Visibility::seeing($project, $people));
    }
}
