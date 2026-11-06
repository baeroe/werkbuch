<?php

namespace App\Actions\WorkItems;

use App\Access\Authorize;
use App\Events\EventType;
use App\Exceptions\Problem;
use App\Models\Comment;
use App\Models\Event;
use App\Models\User;
use App\Models\WorkItem;
use App\Support\Actor;
use App\Support\ListResult;
use App\Support\PageArgs;
use App\Support\RelationChanges;
use Illuminate\Validation\ValidationException;
use Lorisleiva\Actions\Concerns\AsAction;

/**
 * The history of a work item, read from its events (P5), for everybody who sees the item: every `work_item.*` event with
 * the item as subject and the edits and deletions of its comments (`comment.updated` with the old and new text,
 * `comment.deleted` without one, A227, A228), oldest first (`occurred_at` to the microsecond, then id), one entry per
 * event (grouping the changes of one person within minutes is the display's business). Left out: watching
 * (`work_item.subscribed`, `work_item.unsubscribed`, a setting of one person), a `work_item.updated` whose only change
 * is `rank` (the manual order is no history), and every other event on the item: a new comment shows itself, reactions
 * and `bot.mentioned` are no change of it. The versions of a comment that was deleted later are hidden (K15): its
 * `comment.updated` keeps them in the database, the history shows it without `changes`.
 *
 * A relation event stores the other end by id (RelationSnapshot); the reader gets it resolved in
 * `Event::$history_changes` (K5, RelationChanges, the same rule as for webhooks): `{label, item_id, key}` with the
 * current key when they see the other end, else only `{label, hidden: true}`, so no id, key or title of a hidden item
 * leaves the server (P19). The other ends and types of a whole page come with one query each.
 */
final class ListHistory
{
    use AsAction;

    /** The events of an item that are no history: watching is a setting of one person, a reaction is no change of a comment. */
    private const LEFT_OUT = [EventType::WorkItemSubscribed, EventType::WorkItemUnsubscribed, EventType::CommentReactionAdded, EventType::CommentReactionRemoved];

    /** The events of the comments of an item that are history, besides `work_item.*`. */
    private const COMMENTS = [EventType::CommentUpdated, EventType::CommentDeleted];

    /**
     * @param  array<array-key, mixed>  $query  `cursor`, `per_page`
     * @return ListResult<Event>
     *
     * @throws Problem 404 when the account does not see the item
     * @throws ValidationException at `cursor` or `per_page`
     */
    public function handle(Actor $actor, WorkItem $item, array $query): ListResult
    {
        Authorize::check($actor, 'view', $item);
        $args = PageArgs::from($query);

        $events = Event::query()
            // the stamp as the database has it for the cursor: the cast would lose the microseconds (Carbon as text)
            ->select('events.*')->addSelect('events.occurred_at as occurred_cursor')
            ->where('subject_type', $item->getMorphClass())->where('subject_id', $item->id)
            ->where(fn ($types) => $types->where('type', 'like', 'work\_item.%')
                ->orWhereIn('type', array_map(fn (EventType $type) => $type->value, self::COMMENTS)))
            ->whereNotIn('type', array_map(fn (EventType $type) => $type->value, self::LEFT_OUT))
            ->whereNot(fn ($rankOnly) => $rankOnly->where('type', EventType::WorkItemUpdated->value)
                ->whereJsonLength('changes', 1)->whereJsonContainsKey('changes->rank'))
            ->orderBy('occurred_cursor')->orderBy('id');

        $result = ListResult::of($events, $args);
        self::resolve($result->page->items(), $actor->user);

        return $result;
    }

    /**
     * Sets `history_changes` of every event: `changes`, with the relation ends resolved for the reader (RelationChanges)
     * and without the texts of a comment that was deleted since.
     *
     * @param  array<int, Event>  $events
     */
    private static function resolve(array $events, User $reader): void
    {
        RelationChanges::forReader($events, $reader);
        self::hideDeletedComments($events);
    }

    /**
     * Sets `history_changes` of every `comment.updated`: its old and new text while the comment is there, nothing once
     * it is deleted (K15). One query for the whole page, none without such events.
     *
     * @param  array<int, Event>  $events
     */
    private static function hideDeletedComments(array $events): void
    {
        $edits = array_filter($events, fn (Event $event) => $event->type === EventType::CommentUpdated);
        if ($edits === []) {
            return;
        }

        $there = Comment::query()->whereKey(array_map(fn (Event $event) => $event->meta['comment_id'] ?? null, $edits))->pluck('id')->all();
        foreach ($edits as $event) {
            $event->history_changes = in_array($event->meta['comment_id'] ?? null, $there, true) ? $event->changes : null;
        }
    }
}
