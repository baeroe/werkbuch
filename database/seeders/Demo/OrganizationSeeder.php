<?php

namespace Database\Seeders\Demo;

use App\Enums\Locale;
use App\Models\Organization;
use Illuminate\Database\Console\Seeds\WithoutModelEvents;
use Illuminate\Database\Seeder;

/**
 * The organization of the clickdummy (src/api/seed/people.ts): Feldwerk, German, weeks start on Monday. Its row is
 * created by the migration; this seeder only fills it in.
 */
class OrganizationSeeder extends Seeder
{
    use WithoutModelEvents;

    public function run(): void
    {
        Organization::current()->update([
            'name' => 'Feldwerk',
            'locale' => Locale::De,
            'timezone' => 'Europe/Berlin',
            'week_start' => 1,
        ]);
    }
}
