<?php

namespace App\Policies;

use App\Access\Permission;
use App\Access\Visibility;
use App\Models\User;
use Illuminate\Auth\Access\Response;

/**
 * Who may manage accounts (spec 4.2, 4.3): everybody their own profile, org admins (`org.manage`) every profile, the
 * roles, the e-mail addresses, the bots and who is active. Every account sees the list of accounts.
 */
final class UserPolicy
{
    public function update(User $user, User $target): Response
    {
        return $user->is($target) ? Response::allow() : self::admins($user, __('problem.detail.foreign_profile'));
    }

    public function changeEmail(User $user): Response
    {
        return self::admins($user, __('problem.detail.email_admins_only'));
    }

    /** The description and the responsible person of a bot. */
    public function configureBot(User $user): Response
    {
        return self::admins($user, __('problem.detail.bot_settings_admins_only'));
    }

    public function changeRole(User $user): Response
    {
        return self::admins($user, __('problem.detail.roles_admins_only'));
    }

    public function deactivate(User $user): Response
    {
        return self::admins($user, __('problem.detail.deactivate_admins_only'));
    }

    public function reactivate(User $user): Response
    {
        return self::admins($user, __('problem.detail.reactivate_admins_only'));
    }

    public function createBot(User $user): Response
    {
        return self::admins($user, __('problem.detail.create_bot_admins_only'));
    }

    private static function admins(User $user, string $refusal): Response
    {
        return Visibility::can($user, Permission::OrgManage) ? Response::allow() : Response::deny($refusal);
    }
}
