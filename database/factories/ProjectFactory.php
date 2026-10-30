<?php

namespace Database\Factories;

use App\Enums\ProjectVisibility;
use App\Models\Project;
use App\Models\User;
use Illuminate\Database\Eloquent\Factories\Factory;

/**
 * @extends Factory<Project>
 */
class ProjectFactory extends Factory
{
    /**
     * @return array<string, mixed>
     */
    public function definition(): array
    {
        return [
            'identifier' => strtoupper(fake()->unique()->lexify('?????')),
            'name' => fake()->unique()->words(2, true),
            'description' => '',
            'lead_id' => User::factory(),
            'visibility' => ProjectVisibility::Public,
            'next_number' => 0,
        ];
    }

    public function public(): static
    {
        return $this->state(fn (array $attributes) => ['visibility' => ProjectVisibility::Public]);
    }

    public function private(): static
    {
        return $this->state(fn (array $attributes) => ['visibility' => ProjectVisibility::Private]);
    }

    public function archived(): static
    {
        return $this->state(fn (array $attributes) => ['archived_at' => now()]);
    }

    public function identifier(string $identifier): static
    {
        return $this->state(fn (array $attributes) => ['identifier' => $identifier]);
    }
}
