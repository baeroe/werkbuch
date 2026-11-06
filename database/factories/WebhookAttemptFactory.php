<?php

namespace Database\Factories;

use App\Models\WebhookAttempt;
use App\Models\WebhookDelivery;
use Illuminate\Database\Eloquent\Factories\Factory;

/**
 * The first scheduled attempt of a new delivery, now, answered with 200 in 120 ms. `status($code)` answers otherwise,
 * `noAnswer($error)` got no answer at all.
 *
 * @extends Factory<WebhookAttempt>
 */
class WebhookAttemptFactory extends Factory
{
    /**
     * @return array<string, mixed>
     */
    public function definition(): array
    {
        return [
            'delivery_id' => WebhookDelivery::factory(),
            'webhook_id' => fn (array $attributes) => WebhookDelivery::query()->whereKey($attributes['delivery_id'])->value('webhook_id'),
            'attempt' => 1,
            'kind' => WebhookAttempt::SCHEDULED,
            'status_code' => 200,
            'duration_ms' => 120,
            'response_excerpt' => null,
            'error' => null,
            'attempted_at' => fn () => now(),
        ];
    }

    /** Answered with the status. */
    public function status(int $code): static
    {
        return $this->state(['status_code' => $code, 'error' => null]);
    }

    /** No answer, for the reason given (a code and the masked first sentence, A375). */
    public function noAnswer(string $error): static
    {
        return $this->state(['status_code' => null, 'response_excerpt' => null, 'error' => $error]);
    }
}
