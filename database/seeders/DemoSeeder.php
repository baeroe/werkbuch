<?php

namespace Database\Seeders;

use Database\Seeders\Demo\BotsSeeder;
use Database\Seeders\Demo\FavoritesSeeder;
use Database\Seeders\Demo\OrganizationSeeder;
use Database\Seeders\Demo\PeopleSeeder;
use Database\Seeders\Demo\ProjectsSeeder;
use Database\Seeders\Demo\TokensSeeder;
use Illuminate\Database\Console\Seeds\WithoutModelEvents;
use Illuminate\Database\Seeder;
use RuntimeException;

/**
 * Fictional demo data of the Feldwerk team, taken from the clickdummy. Safe to run again: every seeder updates by a
 * stable key. Each phase appends its own seeder to the list in run().
 */
class DemoSeeder extends Seeder
{
    use WithoutModelEvents;

    public const PASSWORD = 'werkbuch-demo';

    public function run(): void
    {
        if (app()->isProduction()) {
            throw new RuntimeException('The demo data must never be seeded in production.');
        }

        $this->call([
            OrganizationSeeder::class,
            PeopleSeeder::class,
            BotsSeeder::class,
            ProjectsSeeder::class,
            FavoritesSeeder::class,
            TokensSeeder::class,
        ]);
    }
}
