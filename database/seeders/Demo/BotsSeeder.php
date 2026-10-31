<?php

namespace Database\Seeders\Demo;

use App\Access\OrgRole;
use App\Access\RoleAssignments;
use App\Enums\AccountType;
use App\Enums\Locale;
use App\Models\User;
use Illuminate\Database\Console\Seeds\WithoutModelEvents;
use Illuminate\Database\Seeder;

/**
 * The bots of the clickdummy: the default bot „Automation“ (made by the migration, here with the German description)
 * and Kira, the bot of Mara.
 */
class BotsSeeder extends Seeder
{
    use WithoutModelEvents;

    public function run(RoleAssignments $roles): void
    {
        User::defaultBot()->update(['description' => __('bots.default.description', [], Locale::De->value)]);

        $kira = User::updateOrCreate(['handle' => 'kira'], [
            'type' => AccountType::Bot,
            'name' => 'Kira',
            'owner_id' => User::query()->where('handle', 'mara')->sole()->id,
            'description' => 'Bot von Mara. Bearbeitet per MCP die Items, die ihm zugewiesen sind.',
            'locale' => Locale::De,
            'timezone' => 'Europe/Berlin',
        ]);

        $roles->setOrgRole($kira, OrgRole::Member);
    }
}
