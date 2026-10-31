<?php

namespace App\Policies;

use App\Access\Permission;
use App\Access\Visibility;
use App\Models\User;
use Illuminate\Auth\Access\Response;

/**
 * Who may manage accounts (spec 4.2, 4.3): everybody their own profile, org admins (`org.manage`) every profile, the
 * roles, the e-mail addresses, the bots, who is active and the invitations. Every account sees the list of accounts.
 * Tokens: everybody their own, org admins those of the bots. Password and second factor: people only, each their own.
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

    public function invite(User $user): Response
    {
        return self::admins($user, __('problem.detail.invite_admins_only'));
    }

    public function viewInvitations(User $user): Response
    {
        return self::admins($user, __('problem.detail.invitations_admins_only'));
    }

    /** The tokens of an account: the own ones, or a bot's for an org admin (spec 4.2), never another person's. */
    public function manageTokens(User $user, User $owner): Response
    {
        return $user->is($owner) || ($owner->isBot() && Visibility::can($user, Permission::OrgManage))
            ? Response::allow()
            : Response::deny(__('problem.detail.tokens_own_or_bots'));
    }

    /** Revoking a token: whoever may not manage the tokens of its account does not get to know the token exists (404). */
    public function revokeToken(User $user, User $owner): Response
    {
        return $this->manageTokens($user, $owner)->allowed() ? Response::allow() : Response::denyAsNotFound();
    }

    /** The own password and second factor: only people sign in. */
    public function manageSignIn(User $user): Response
    {
        return $user->isPerson() ? Response::allow() : Response::deny(__('problem.detail.people_only'));
    }

    private static function admins(User $user, string $refusal): Response
    {
        return Visibility::can($user, Permission::OrgManage) ? Response::allow() : Response::deny($refusal);
    }
}
