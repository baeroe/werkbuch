<?php

namespace Database\Factories;

use App\Models\NotificationMail;
use App\Models\User;
use Carbon\CarbonInterface;
use Illuminate\Database\Eloquent\Factories\Factory;
use Illuminate\Support\Str;

/**
 * An open collection of a new account for one item, due after `notification_mail_delay` minutes.
 *
 * @extends Factory<NotificationMail>
 */
class NotificationMailFactory extends Factory
{
    /**
     * @return array<string, mixed>
     */
    public function definition(): array
    {
        return [
            'user_id' => User::factory(),
            'scope' => fn () => 'item:'.Str::lower((string) Str::ulid()),
            'open_key' => fn (array $attributes) => "{$attributes['user_id']}:{$attributes['scope']}",
            'due_at' => fn () => now()->addMinutes((int) config('werkbuch.notification_mail_delay')),
        ];
    }

    /** Sent at the moment, closed for new lines. */
    public function sent(?CarbonInterface $at = null): static
    {
        return $this->state(fn (array $attributes) => ['open_key' => null, 'sent_at' => $at ?? now(), 'outcome' => NotificationMail::SENT]);
    }

    /** Closed without a mail: nothing was left to tell (K8). */
    public function skipped(): static
    {
        return $this->state(fn (array $attributes) => ['open_key' => null, 'sent_at' => now(), 'outcome' => NotificationMail::SKIPPED]);
    }
}
