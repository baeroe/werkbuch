<?php

namespace App\Http\Resources;

use App\Models\AgentRunEvent;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

/**
 * A line of the log of a run (spec 6.4).
 *
 * @mixin AgentRunEvent
 */
final class AgentRunEventResource extends JsonResource
{
    /**
     * @return array<string, mixed>
     */
    public function toArray(Request $request): array
    {
        /** @var AgentRunEvent $event */
        $event = $this->resource;

        return [
            'id' => $event->id,
            'attempt' => $event->attempt,
            'kind' => $event->kind,
            'text' => $event->text,
            'at' => $event->at->toJSON(),
        ];
    }
}
