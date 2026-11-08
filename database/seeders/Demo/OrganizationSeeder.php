<?php

namespace Database\Seeders\Demo;

use App\Models\Organization;
use Database\Seeders\Demo\Texts\DemoTexts;
use Illuminate\Database\Console\Seeds\WithoutModelEvents;
use Illuminate\Database\Seeder;

/**
 * The organization of the clickdummy (src/api/seed/people.ts): Feldwerk, German (Fieldwork in English), weeks start on
 * Monday, in the zone of Berlin in either language. Its row is created by the migration; this seeder only fills it in.
 */
class OrganizationSeeder extends Seeder
{
    use WithoutModelEvents;

    public function run(): void
    {
        Organization::current()->update([
            'name' => DemoTexts::get('organization.name'),
            'locale' => DemoTexts::current(),
            'timezone' => 'Europe/Berlin',
            'week_start' => 1,
        ]);
    }
}
