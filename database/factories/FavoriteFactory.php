<?php

namespace Database\Factories;

use App\Models\Favorite;
use App\Models\Project;
use App\Models\User;
use Illuminate\Database\Eloquent\Factories\Factory;

/**
 * @extends Factory<Favorite>
 */
class FavoriteFactory extends Factory
{
    /**
     * @return array<string, mixed>
     */
    public function definition(): array
    {
        return [
            'user_id' => User::factory(),
            'favoritable_type' => 'project',
            'favoritable_id' => Project::factory(),
            'position' => 0,
        ];
    }
}
