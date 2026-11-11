<?php

namespace Database\Seeders\Demo;

use App\Access\OrgRole;
use App\Access\RoleAssignments;
use App\Enums\AccountType;
use App\Models\User;
use Database\Seeders\Demo\Texts\DemoTexts;
use Illuminate\Database\Console\Seeds\WithoutModelEvents;
use Illuminate\Database\Seeder;

/**
 * The bots of the clickdummy: the default bot „Automation“ (made by the migration, here with the description in the
 * language of the demo, from lang/) and Kira, the bot of Mara.
 */
class BotsSeeder extends Seeder
{
    use WithoutModelEvents;

    public function run(RoleAssignments $roles): void
    {
        $locale = DemoTexts::current();
        User::defaultBot()->update(['description' => __('bots.default.description', [], $locale->value)]);

        $kira = User::updateOrCreate(['handle' => 'kira'], [
            'type' => AccountType::Bot,
            'name' => DemoTexts::get('bot.kira.name'),
            'owner_id' => User::query()->where('handle', 'mara')->sole()->id,
            'description' => DemoTexts::get('bot.kira.description'),
            'locale' => $locale,
            'timezone' => 'Europe/Berlin',
        ]);

        $roles->setOrgRole($kira, OrgRole::Member);
    }
}
