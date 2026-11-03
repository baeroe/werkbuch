<?php

namespace App\Http\Resources;

use App\Models\Event;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

/**
 * One entry of the history of a work item (`ItemEvent` in resources/js/types.ts): the event with who did it
 * (`actor_id`), how (`via`) and why (`reason`, both from `meta`) and its changes as the reader may see them
 * (`Event::$history_changes`, resolved by App\Actions\WorkItems\ListHistory: a relation names the other end only when
 * the reader sees it) and, for a move, the two states as they were then (`states`, `{old, new}` with `id`, `name`,
 * `category` from `meta.states`; `null` for other events and for events recorded before the snapshot). An edit or
 * deletion of a comment names the comment and its author (`comment_id`, `comment_author_id` from `meta`); an edit
 * carries the old and new text in `changes.body` as Tiptap JSON, unless the comment was deleted later. It asks the
 * database nothing (K5).
 *
 * @mixin Event
 */
final class HistoryEntryResource extends JsonResource
{
    /**
     * @return array<string, mixed>
     */
    public function toArray(Request $request): array
    {
        /** @var Event $event */
        $event = $this->resource;

        return [
            'id' => $event->id,
            'type' => $event->type->value,
            'actor_id' => $event->actor_id,
            'subject' => ['type' => $event->subject_type, 'id' => $event->subject_id],
            'project_id' => $event->project_id,
            'changes' => $event->history_changes,
            // the states of a `work_item.state_changed` as they were then (StateSnapshot); null elsewhere and in older events
            'states' => $event->meta['states'] ?? null,
            'reason' => $event->meta['reason'] ?? null,
            'via' => $event->meta['via'] ?? null,
            // a change of a comment (`comment.updated`, `comment.deleted`): which one and whose; null elsewhere
            'comment_id' => $event->meta['comment_id'] ?? null,
            'comment_author_id' => $event->meta['author_id'] ?? null,
            'occurred_at' => $event->occurred_at->toJSON(),
        ];
    }
}
