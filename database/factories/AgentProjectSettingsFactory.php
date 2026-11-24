<?php

namespace Database\Factories;

use App\Models\AgentProjectSettings;
use App\Models\Project;
use Illuminate\Database\Eloquent\Factories\Factory;

/**
 * The agent settings of a new project with the defaults. No events.
 *
 * @extends Factory<AgentProjectSettings>
 */
class AgentProjectSettingsFactory extends Factory
{
    /**
     * @return array<string, mixed>
     */
    public function definition(): array
    {
        return ['project_id' => Project::factory(), ...AgentProjectSettings::DEFAULTS];
    }
}
