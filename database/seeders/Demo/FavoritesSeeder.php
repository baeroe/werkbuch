<?php

namespace Database\Seeders\Demo;

use App\Models\Favorite;
use App\Models\Project;
use App\Models\User;
use App\Models\View;
use Illuminate\Database\Console\Seeds\WithoutModelEvents;
use Illuminate\Database\Seeder;

/**
 * The favorites of the clickdummy (src/api/seed/workspace.ts) with their positions: projects and views share one
 * order, which is why Mara's projects start at position 3 behind her three views (ViewsSeeder).
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
        $projectType = (new Project)->getMorphClass();

        foreach ($favorites as $handle => $positions) {
            foreach ($positions as $identifier => $position) {
                Favorite::updateOrCreate(
                    ['user_id' => $accounts[$handle], 'favoritable_type' => $projectType, 'favoritable_id' => $projects[$identifier]],
                    ['position' => $position],
                );
            }
        }

        $views = [
            'mara' => ['Fällig diese Woche' => 0, 'Bugs in Produktion' => 1, 'Für Kira' => 2],
            'jonas' => ['Blockiert' => 0],
            'ida' => ['Bugs in Produktion' => 0],
            'theo' => ['Studio Nordlicht' => 0],
        ];
        $viewType = (new View)->getMorphClass();

        foreach ($views as $handle => $positions) {
            foreach ($positions as $name => $position) {
                $view = View::query()->where('name', $name)->where('created_by', $accounts[ViewsSeeder::CREATORS[$name]])->sole();

                Favorite::updateOrCreate(
                    ['user_id' => $accounts[$handle], 'favoritable_type' => $viewType, 'favoritable_id' => $view->id],
                    ['position' => $position],
                );
            }
        }
    }
}
