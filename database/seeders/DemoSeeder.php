<?php

namespace Database\Seeders;

use Database\Seeders\Demo\PeopleSeeder;
use Illuminate\Database\Seeder;
use RuntimeException;

/**
 * Fictional demo data of the Feldwerk team, taken from the clickdummy. Safe to run again: every seeder updates by a
 * stable key. Each phase appends its own seeder to the list in run().
 */
class DemoSeeder extends Seeder
{
    public const PASSWORD = 'werkbuch-demo';

    public function run(): void
    {
        if (app()->isProduction()) {
            throw new RuntimeException('The demo data must never be seeded in production.');
        }

        $this->call([
            PeopleSeeder::class,
        ]);
    }
}
