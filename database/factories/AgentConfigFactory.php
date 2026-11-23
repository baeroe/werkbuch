<?php

namespace Database\Factories;

use App\Domain\Agents\AgentCli;
use App\Models\AgentConfig;
use App\Models\User;
use Illuminate\Database\Eloquent\Factories\Factory;

/**
 * An agent switched on for a new bot (of a new person), with Claude Code and Sonnet on every runner. No events.
 *
 * @extends Factory<AgentConfig>
 */
class AgentConfigFactory extends Factory
{
    /**
     * @return array<string, mixed>
     */
    public function definition(): array
    {
        return [
            'bot_id' => User::factory()->bot(User::factory()->create()),
            'enabled' => true,
            'runner_ids' => [],
            'cli' => AgentCli::Claude,
            'model' => 'sonnet',
            'models' => [],
        ];
    }
}
