<?php

namespace Database\Factories;

use App\Models\GitHubInstallation;
use Illuminate\Database\Eloquent\Factories\Factory;

/**
 * An installation of the app on the organization account `feldwerk` with chosen repos.
 *
 * @extends Factory<GitHubInstallation>
 */
class GitHubInstallationFactory extends Factory
{
    /**
     * @return array<string, mixed>
     */
    public function definition(): array
    {
        return [
            'installation_id' => 55_000_000 + fake()->unique()->numberBetween(1, 999_999),
            'account_login' => 'feldwerk',
            'account_type' => 'Organization',
            'repository_selection' => 'selected',
            'suspended_at' => null,
            'removed_at' => null,
        ];
    }
}
