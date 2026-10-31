<?php

namespace Database\Factories;

use App\Models\RelationType;
use Illuminate\Database\Eloquent\Factories\Factory;

/**
 * @extends Factory<RelationType>
 */
class RelationTypeFactory extends Factory
{
    /**
     * @return array<string, mixed>
     */
    public function definition(): array
    {
        return [
            'name' => fake()->unique()->words(2, true),
            'outward_label' => 'blocks',
            'inward_label' => 'is blocked by',
            'built_in' => null,
        ];
    }
}
