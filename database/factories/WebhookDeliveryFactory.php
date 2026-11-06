<?php

namespace Database\Factories;

use App\Models\Webhook;
use App\Models\WebhookDelivery;
use Illuminate\Database\Eloquent\Factories\Factory;
use Illuminate\Support\Str;

/**
 * A pending delivery of a `work_item.created` of an event of its own to a new webhook, with the body `{}` and no attempt
 * yet.
 *
 * @extends Factory<WebhookDelivery>
 */
class WebhookDeliveryFactory extends Factory
{
    /**
     * @return array<string, mixed>
     */
    public function definition(): array
    {
        return [
            'webhook_id' => Webhook::factory(),
            'event_id' => fn () => (string) Str::ulid(),
            'event' => 'work_item.created',
            'body' => '{}',
            'status' => WebhookDelivery::PENDING,
            'attempts' => 0,
        ];
    }
}
