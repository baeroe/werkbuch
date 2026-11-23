<?php

namespace Database\Factories;

use App\Models\AgentConfig;
use App\Models\AgentThread;
use App\Models\WorkItem;
use Illuminate\Database\Eloquent\Factories\Factory;

/**
 * An open strand of a new item; bot and project as the caller sets them. No events.
 *
 * @extends Factory<AgentThread>
 */
class AgentThreadFactory extends Factory
{
    /**
     * @return array<string, mixed>
     */
    public function definition(): array
    {
        return [
            'bot_id' => fn () => AgentConfig::factory()->create()->bot_id,
            'work_item_id' => WorkItem::factory(),
            'project_id' => fn (array $attributes) => WorkItem::query()->whereKey((string) $attributes['work_item_id'])->firstOrFail()->project_id,
            'runner_id' => null,
            'branch' => null,
            'base_branch' => 'main',
            'status' => AgentThread::OPEN,
        ];
    }
}
