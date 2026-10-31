<?php

namespace App\Http\Resources;

use App\Models\Event;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

/**
 * One entry of the history of a work item (`ItemEvent` in resources/js/types.ts): the event with who did it
 * (`actor_id`), how (`via`) and why (`reason`, both from `meta`) and its changes as the reader may see them
 * (`Event::$history_changes`, resolved by App\Actions\WorkItems\ListHistory: a relation names the other end only when
 * the reader sees it). It asks the database nothing (K5).
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
            'reason' => $event->meta['reason'] ?? null,
            'via' => $event->meta['via'] ?? null,
            'occurred_at' => $event->occurred_at->toJSON(),
        ];
    }
}
