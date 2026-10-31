<?php

namespace Database\Factories;

use App\Domain\Catalog\Tone;
use App\Models\WorkItemType;
use Illuminate\Database\Eloquent\Factories\Factory;

/**
 * @extends Factory<WorkItemType>
 */
class WorkItemTypeFactory extends Factory
{
    /**
     * @return array<string, mixed>
     */
    public function definition(): array
    {
        return [
            'name' => fake()->unique()->words(2, true),
            'icon' => 'square-check',
            'tone' => Tone::Sky,
            'description' => '',
            'is_epic' => false,
            'archived_at' => null,
        ];
    }

    public function archived(): static
    {
        return $this->state(fn (array $attributes) => ['archived_at' => now()]);
    }

    public function epic(): static
    {
        return $this->state(fn (array $attributes) => ['is_epic' => true]);
    }
}
