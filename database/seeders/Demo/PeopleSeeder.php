<?php

namespace Database\Seeders\Demo;

use App\Access\OrgRole;
use App\Access\RoleAssignments;
use App\Enums\AccountType;
use App\Enums\Locale;
use App\Models\User;
use Database\Seeders\DemoSeeder;
use Illuminate\Database\Console\Seeds\WithoutModelEvents;
use Illuminate\Database\Seeder;
use Illuminate\Support\Carbon;

/**
 * The six people of the clickdummy (src/api/seed/people.ts) with their organization roles: Mara is the admin, the
 * others are members.
 */
class PeopleSeeder extends Seeder
{
    use WithoutModelEvents;

    private const TIMEZONE = 'Europe/Berlin';

    public function run(RoleAssignments $roles): void
    {
        // Eloquent stores the wall-clock time of the Carbon as it is, so the moment goes in as UTC like the app time zone.
        $people = [
            'mara' => 'Mara Lindqvist',
            'jonas' => 'Jonas Feld',
            'ida' => 'Ida Brenner',
            'theo' => 'Theo Okafor',
            'lene' => 'Lene Vogt',
            'sven' => 'Sven Albers',
        ];

        foreach ($people as $handle => $name) {
            $user = User::updateOrCreate(['email' => $handle.'@feldwerk.example.com'], [
                'type' => AccountType::Person,
                'name' => $name,
                'handle' => $handle,
                'locale' => Locale::De,
                'timezone' => self::TIMEZONE,
                'password' => DemoSeeder::PASSWORD,
                'disabled_at' => $handle === 'sven' ? Carbon::parse('2026-09-18 17:00', self::TIMEZONE)->utc() : null,
            ]);

            $roles->setOrgRole($user, $handle === 'mara' ? OrgRole::Admin : OrgRole::Member);
        }
    }
}
