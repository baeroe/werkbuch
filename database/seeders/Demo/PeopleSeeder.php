<?php

namespace Database\Seeders\Demo;

use App\Access\OrgRole;
use App\Access\RoleAssignments;
use App\Enums\AccountType;
use App\Models\User;
use Database\Seeders\Demo\Texts\DemoTexts;
use Database\Seeders\DemoSeeder;
use Illuminate\Database\Console\Seeds\WithoutModelEvents;
use Illuminate\Database\Seeder;
use Illuminate\Support\Carbon;

/**
 * The six people of the clickdummy (src/api/seed/people.ts) with their organization roles: Mara is the admin, the
 * others are members. Name, mail domain and language follow the language of the demo, the handles stay.
 */
class PeopleSeeder extends Seeder
{
    use WithoutModelEvents;

    private const TIMEZONE = 'Europe/Berlin';

    public function run(RoleAssignments $roles): void
    {
        // Eloquent stores the wall-clock time of the Carbon as it is, so the moment goes in as UTC like the app time zone.
        $domain = DemoTexts::get('organization.mail_domain');

        foreach (['mara', 'jonas', 'ida', 'theo', 'lene', 'sven'] as $handle) {
            $user = User::updateOrCreate(['email' => "{$handle}@{$domain}"], [
                'type' => AccountType::Person,
                'name' => DemoTexts::get("person.{$handle}.name"),
                'handle' => $handle,
                'locale' => DemoTexts::current(),
                'timezone' => self::TIMEZONE,
                'password' => DemoSeeder::PASSWORD,
                'disabled_at' => $handle === 'sven' ? Carbon::parse('2026-09-18 17:00', self::TIMEZONE)->utc() : null,
            ]);

            $roles->setOrgRole($user, $handle === 'mara' ? OrgRole::Admin : OrgRole::Member);
        }
    }
}
