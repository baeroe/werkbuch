<?php

namespace Database\Factories;

use App\Models\GitHubRepository;
use App\Models\Project;
use App\Models\ProjectRepository;
use Illuminate\Database\Eloquent\Factories\Factory;

/**
 * A project with a repo on `main`, no ruleset known, no guard. No events.
 *
 * @extends Factory<ProjectRepository>
 */
class ProjectRepositoryFactory extends Factory
{
    /**
     * @return array<string, mixed>
     */
    public function definition(): array
    {
        return [
            'project_id' => Project::factory(),
            'repository_id' => GitHubRepository::factory(),
            'base_branch' => 'main',
            'protected' => null,
            'protected_checked_at' => null,
        ];
    }
}
