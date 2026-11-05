<?php

namespace App\Support;

use App\Actions\WorkItems\RemapStates;
use App\Domain\Notifications\EventFacts;
use App\Domain\Notifications\NotificationKind;
use App\Enums\AccountType;
use App\Events\EventType;
use App\Models\Event;
use App\Models\Project;
use App\Models\User;
use App\Models\WorkItem;
use App\Models\WorkItemSubscriber;
use App\RichText\Document;

/**
 * What the consumer `notifications` reads of an event (phase 8, task 5): the facts Recipients decides on, read now,
 * when the event is consumed, and the `data` a notification stores of it. Every event of the outbox passes through
 * here, the ones that tell nobody (A270) without a query.
 */
final class NotificationFacts
{
    /**
     * The events that may tell somebody something (App\Domain\Notifications\Recipients); all of them hang on an item but
     * `template.run_failed`, which hangs on its template (phase 10).
     */
    public const TELLING = [
        EventType::WorkItemCreated, EventType::WorkItemUpdated, EventType::WorkItemStateChanged, EventType::WorkItemAssigned,
        EventType::WorkItemRelationAdded, EventType::WorkItemRelationRemoved, EventType::CommentCreated, EventType::CommentUpdated,
        EventType::TemplateRunFailed,
    ];

    /**
     * Reasons of RemapStates: a workflow rebuilt is no work on the item, and would tell every watcher of every item of
     * the project at once (ruling of T3-M4). The history shows the move.
     */
    private const QUIET_REASONS = [RemapStates::WORKFLOW_CHANGED, RemapStates::STATE_REMOVED];

    /**
     * The facts of the event, or null when it tells nobody: a type without a kind of notification, a state moved by a
     * rebuilt workflow, work of the night nobody is told of (`meta.quiet`, A357: the move and the comment of Auto-Close
     * and a parent its move closes), an item that is gone or a project being deleted. Reads the item with its project, the
     * subscribers (watchers and opt-outs together) and the people among the mentioned in one query each; the assignee
     * of a new item with one more. A failed template run reads only its project: the lead, and the author from
     * `meta.author_id` (the template may be gone by now; the run failed all the same). Whoever an automation or a run by
     * hand acted for (`meta.on_behalf_of`) is `causedBy`, for every event (A342, K12).
     */
    public static function of(Event $event): ?EventFacts
    {
        $meta = $event->meta;
        if (! in_array($event->type, self::TELLING, true) || ($meta['quiet'] ?? false) === true
            || ($event->type === EventType::WorkItemStateChanged && in_array($meta['reason'] ?? null, self::QUIET_REASONS, true))) {
            return null;
        }

        if ($event->type === EventType::TemplateRunFailed) {
            return self::ofTemplateRun($event);
        }

        // the events of a comment hang on its item (A227): the subject is always the item
        $item = WorkItem::query()->with('project')->find($event->subject_id);
        if ($item === null || $item->project->deleting_at !== null) {
            return null;
        }

        $subscribers = WorkItemSubscriber::query()->where('work_item_id', $item->id)->get(['user_id', 'unsubscribed_at']);
        $changes = $event->changes;

        return new EventFacts(
            type: $event->type->value,
            actorId: $event->actor_id,
            projectId: $item->project_id,
            itemId: $item->id,
            changedFields: EventFacts::fieldsOf($event->type->value, $changes),
            mentioned: self::people($meta['mentioned'] ?? [], $event->actor_id),
            assignee: match ($event->type) {
                EventType::WorkItemAssigned => self::id($changes['assignee_id']['new'] ?? null),
                EventType::WorkItemCreated => self::assigneeAtCreation($item),
                default => null,
            },
            watchers: self::userIds($subscribers->whereNull('unsubscribed_at')),
            optedOut: self::userIds($subscribers->whereNotNull('unsubscribed_at')),
            leadId: $item->project->lead_id,
            stateSnapshot: is_array($meta['states'] ?? null) ? $meta['states'] : null,
            causedBy: self::id($meta['on_behalf_of'] ?? null),
        );
    }

    /** The facts of a failed run of a template: its project, lead and author, no item. */
    private static function ofTemplateRun(Event $event): ?EventFacts
    {
        $project = Project::query()->find($event->project_id);
        if ($project === null || $project->deleting_at !== null) {
            return null;
        }

        return new EventFacts(
            type: $event->type->value,
            actorId: $event->actor_id,
            projectId: $project->id,
            itemId: null,
            changedFields: [],
            mentioned: [],
            assignee: null,
            watchers: [],
            optedOut: [],
            leadId: $project->lead_id,
            stateSnapshot: null,
            templateAuthorId: self::id($event->meta['author_id'] ?? null),
            causedBy: self::id($event->meta['on_behalf_of'] ?? null),
        );
    }

    /**
     * What a notification of the kind stores of the event (table "Benachrichtigungsarten" of the phase plan 8): never a
     * text or a value, only what names it (A272). `$inDescription`: whether the current description of the item
     * mentions the person, for the `source` of a mention outside a comment (K13).
     *
     * @return array<string, mixed>
     */
    public static function data(Event $event, NotificationKind $kind, bool $inDescription): array
    {
        $comment = in_array($event->type, [EventType::CommentCreated, EventType::CommentUpdated], true);

        return match ($kind) {
            NotificationKind::Mentioned => $comment
                ? ['source' => 'comment', 'comment_id' => $event->meta['comment_id'] ?? null]
                : ['source' => $inDescription ? 'description' : 'values'],
            NotificationKind::Comment => ['comment_id' => $event->meta['comment_id'] ?? null],
            NotificationKind::StateChanged => ['from' => $event->meta['states']['old'] ?? null, 'to' => $event->meta['states']['new'] ?? null],
            NotificationKind::ItemChanged => ['fields' => EventFacts::fieldsOf($event->type->value, $event->changes)],
            NotificationKind::TemplateRunFailed => ['template_id' => $event->subject_id, 'error' => $event->meta['error'] ?? null],
            default => [],
        };
    }

    /**
     * The accounts the current description of the item mentions (none when the item is gone or has no description).
     *
     * @return list<string>
     */
    public static function describedIn(string $itemId): array
    {
        $description = WorkItem::query()->whereKey($itemId)->value('description');

        return is_array($description) ? Document::fromJson($description)->mentionedUserIds() : [];
    }

    /**
     * The people among the IDs, without the actor; bots hear of a mention through `bot.mentioned`.
     *
     * @return list<string>
     */
    private static function people(mixed $ids, string $actorId): array
    {
        $ids = array_values(array_diff(array_filter(is_array($ids) ? $ids : [], 'is_string'), [$actorId]));
        if ($ids === []) {
            return [];
        }
        $people = User::query()->whereKey($ids)->where('type', AccountType::Person)->pluck('id')->all();

        return array_values(array_intersect($ids, $people));
    }

    /**
     * Who the new item was assigned to when it was created: its assignee, unless the item changed hands since; then the
     * old assignee of the first `work_item.assigned` after the creation.
     */
    private static function assigneeAtCreation(WorkItem $item): ?string
    {
        // every assignment of the item came after its creation
        $next = Event::query()
            ->where('type', EventType::WorkItemAssigned)
            ->where('subject_type', $item->getMorphClass())->where('subject_id', $item->id)
            ->orderBy('occurred_at')->orderBy('id')->first();

        return $next === null ? $item->assignee_id : self::id($next->changes['assignee_id']['old'] ?? null);
    }

    private static function id(mixed $value): ?string
    {
        return is_string($value) ? $value : null;
    }

    /**
     * @param  iterable<WorkItemSubscriber>  $rows
     * @return list<string>
     */
    private static function userIds(iterable $rows): array
    {
        $ids = [];
        foreach ($rows as $row) {
            $ids[] = $row->user_id;
        }

        return $ids;
    }
}
