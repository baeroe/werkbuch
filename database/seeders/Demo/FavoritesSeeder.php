<?php

namespace Database\Seeders\Demo;

use App\Models\Favorite;
use App\Models\Project;
use App\Models\User;
use Illuminate\Database\Console\Seeds\WithoutModelEvents;
use Illuminate\Database\Seeder;

/**
 * The project favorites of the clickdummy (src/api/seed/workspace.ts) with their positions; the views between them
 * follow with the views in Phase 5, which is why Mara's projects start at position 3.
 */
class FavoritesSeeder extends Seeder
{
    use WithoutModelEvents;

    public function run(): void
    {
        $favorites = [
            'mara' => ['WEB' => 3, 'APP' => 4, 'OPS' => 5],
            'jonas' => ['OPS' => 1, 'WEB' => 2],
            'ida' => ['WEB' => 1],
            'theo' => ['APP' => 1],
            'lene' => ['WEB' => 0, 'APP' => 1],
        ];

        $accounts = User::query()->pluck('id', 'handle');
        $projects = Project::query()->pluck('id', 'identifier');

        foreach ($favorites as $handle => $positions) {
            foreach ($positions as $identifier => $position) {
                Favorite::updateOrCreate(
                    ['user_id' => $accounts[$handle], 'favoritable_type' => 'project', 'favoritable_id' => $projects[$identifier]],
                    ['position' => $position],
                );
            }
        }
    }
}
