<?php

namespace Database\Factories;

use App\Models\Project;
use App\Models\User;
use App\Models\Webhook;
use DateTimeInterface;
use Illuminate\Database\Eloquent\Factories\Factory;

/**
 * An active webhook of the organization for every event of work items (`work_item.*`) at a receiver on example.com, with
 * a fresh secret, created by a new org admin. No events (those are the work of App\Actions\Webhooks).
 *
 * @extends Factory<Webhook>
 */
class WebhookFactory extends Factory
{
    /**
     * @return array<string, mixed>
     */
    public function definition(): array
    {
        return [
            'name' => 'Empfänger',
            'url' => 'https://receiver.example.com/hook',
            'secret' => Webhook::newSecret(),
            'project_id' => null,
            'events' => ['work_item.*'],
            'bot_id' => null,
            'active' => true,
            'disabled_at' => null,
            'failing_since' => null,
            'last_success_at' => null,
            'created_by' => User::factory()->admin(),
        ];
    }

    /** Only for the events of the project. */
    public function forProject(Project $project): static
    {
        return $this->state(['project_id' => $project->id]);
    }

    /** Only what the bot sees. */
    public function forBot(User $bot): static
    {
        return $this->state(['bot_id' => $bot->id]);
    }

    /** Switched off by the system at the moment given, now without one. */
    public function disabled(?DateTimeInterface $at = null): static
    {
        return $this->state(fn () => ['active' => false, 'disabled_at' => $at ?? now()]);
    }

    /** Failing since the moment given, without a success since. */
    public function failingSince(DateTimeInterface $at): static
    {
        return $this->state(['failing_since' => $at]);
    }
}
