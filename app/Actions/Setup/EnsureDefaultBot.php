<?php

namespace App\Actions\Setup;

use App\Access\OrgRole;
use App\Access\RoleAssignments;
use App\Actions\Accounts\NextHandle;
use App\Enums\AccountType;
use App\Events\EventRecorder;
use App\Events\EventType;
use App\Models\Organization;
use App\Models\User;
use App\Support\Actor;
use Illuminate\Support\Facades\DB;
use Lorisleiva\Actions\Concerns\AsAction;

/**
 * Makes sure the default bot exists (spec 4.2): the bot automations and template schedules act as, named „Automation“,
 * an org admin so it may act in every project. Runs from the migration and creates it only when there is none.
 */
final class EnsureDefaultBot
{
    use AsAction;

    public function __construct(private readonly RoleAssignments $roles) {}

    public function handle(): User
    {
        return DB::transaction(function (): User {
            $existing = User::query()->where('is_default_bot', true)->first();

            if ($existing !== null) {
                return $existing;
            }

            $bot = User::query()->create([
                'type' => AccountType::Bot,
                'name' => 'Automation',
                'handle' => NextHandle::run('automation'),
                'is_default_bot' => true,
                'description' => __('bots.default.description', [], Organization::current()->locale->value),
            ]);

            $this->roles->setOrgRole($bot, OrgRole::Admin);
            EventRecorder::record(EventType::BotCreated, Actor::system($bot, 'default_bot'), $bot, null);

            return $bot;
        });
    }
}
