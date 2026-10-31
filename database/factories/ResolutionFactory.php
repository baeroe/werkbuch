<?php

namespace Database\Factories;

use App\Models\Resolution;
use Illuminate\Database\Eloquent\Factories\Factory;

/**
 * @extends Factory<Resolution>
 */
class ResolutionFactory extends Factory
{
    /**
     * @return array<string, mixed>
     */
    public function definition(): array
    {
        $last = Resolution::query()->max('position');

        return [
            'label' => fake()->unique()->words(2, true),
            'default_for' => null,
            'position' => $last === null ? 0 : (int) $last + 1,
            'archived_at' => null,
        ];
    }
}
