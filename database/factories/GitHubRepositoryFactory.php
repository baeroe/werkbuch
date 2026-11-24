<?php

namespace Database\Factories;

use App\Models\GitHubInstallation;
use App\Models\GitHubRepository;
use Illuminate\Database\Eloquent\Factories\Factory;

/**
 * A private repo of `feldwerk` an installation reaches, default branch `main`.
 *
 * @extends Factory<GitHubRepository>
 */
class GitHubRepositoryFactory extends Factory
{
    /**
     * @return array<string, mixed>
     */
    public function definition(): array
    {
        $name = 'feldwerk/repo-'.fake()->unique()->numberBetween(1, 999_999);

        return [
            'installation_id' => GitHubInstallation::factory(),
            'github_id' => 700_000_000 + fake()->unique()->numberBetween(1, 9_999_999),
            'full_name' => $name,
            'private' => true,
            'default_branch' => 'main',
            'html_url' => 'https://github.com/'.$name,
            'removed_at' => null,
        ];
    }
}
