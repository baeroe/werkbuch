<?php

namespace App\Http\Resources;

use App\Models\Webhook;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

/**
 * A webhook as `Webhook` of the plan "REST" (the clickdummy's types.ts): never its secret, which is only in the answers
 * of creating and of renewing it, next to `data`.
 *
 * @mixin Webhook
 */
final class WebhookResource extends JsonResource
{
    /**
     * @return array<string, mixed>
     */
    public function toArray(Request $request): array
    {
        /** @var Webhook $webhook */
        $webhook = $this->resource;

        return [
            'id' => $webhook->id,
            'name' => $webhook->name,
            'url' => $webhook->url,
            'project_id' => $webhook->project_id,
            'events' => $webhook->events,
            'bot_id' => $webhook->bot_id,
            'active' => $webhook->active,
            'disabled_at' => $webhook->disabled_at?->toJSON(),
            'failing_since' => $webhook->failing_since?->toJSON(),
            'last_success_at' => $webhook->last_success_at?->toJSON(),
            'created_by' => $webhook->created_by,
            'created_at' => $webhook->created_at?->toJSON(),
            'updated_at' => $webhook->updated_at?->toJSON(),
        ];
    }
}
