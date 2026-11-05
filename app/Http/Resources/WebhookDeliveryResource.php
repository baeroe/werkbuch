<?php

namespace App\Http\Resources;

use App\Models\WebhookAttempt;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

/**
 * One attempt in the form `WebhookDelivery` of the clickdummy (plan "REST"): `id` is the attempt, `delivery_id` the
 * delivery (the header `X-Werkbuch-Delivery`), `created_at` the time of the attempt. The delivery must be loaded
 * (`delivery:id,event`); the resource asks nothing.
 *
 * @mixin WebhookAttempt
 */
final class WebhookDeliveryResource extends JsonResource
{
    /**
     * @return array<string, mixed>
     */
    public function toArray(Request $request): array
    {
        /** @var WebhookAttempt $attempt */
        $attempt = $this->resource;

        return [
            'id' => $attempt->id,
            'delivery_id' => $attempt->delivery_id,
            'webhook_id' => $attempt->webhook_id,
            'event' => $attempt->delivery->event,
            'attempt' => $attempt->attempt,
            'kind' => $attempt->kind,
            'status_code' => $attempt->status_code,
            'duration_ms' => $attempt->duration_ms,
            'response_excerpt' => $attempt->response_excerpt,
            'error' => $attempt->error,
            'created_at' => $attempt->attempted_at->toJSON(),
        ];
    }
}
