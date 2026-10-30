<?php

use App\Actions\Account\ChangePassword;
use App\Actions\Account\ConfirmTwoFactor;
use App\Actions\Account\DisableTwoFactor;
use App\Actions\Account\EnableTwoFactor;
use App\Actions\Account\GetTwoFactor;
use App\Actions\Account\RegenerateRecoveryCodes;
use App\Actions\Invitations\InviteUser;
use App\Actions\Invitations\ListInvitations;
use App\Actions\Media\ShowMedia;
use App\Actions\Organization\GetOrganization;
use App\Actions\Organization\UpdateOrganization;
use App\Actions\Tokens\CreateToken;
use App\Actions\Tokens\ListTokens;
use App\Actions\Tokens\RevokeToken;
use App\Actions\Users\CreateBot;
use App\Actions\Users\DeactivateUser;
use App\Actions\Users\ListUsers;
use App\Actions\Users\ReactivateUser;
use App\Actions\Users\UpdateUser;
use App\Actions\Users\UpdateUserRole;
use App\Events\EventType;
use App\Models\User;
use App\Support\Actor;
use Laravel\Fortify\Actions\EnableTwoFactorAuthentication;
use PragmaRX\Google2FA\Google2FA;
use Tests\Feature\Access\MatrixWorld;

/*
 * The rights matrix (RightsMatrixTest): every action × every kind of account. A row names the action, how to run it in
 * the MatrixWorld (with valid input, so an allowed call succeeds), the columns that may run it (`allowed`), the columns
 * that must not even see what it acts on (`hidden`: 404 instead of 403) and the event an allowed call records. Rows with
 * `'system' => true` are work of jobs without REST: they run once as the system and must not fail.
 *
 * Not in the matrix, on purpose:
 * - App\Actions\Auth\*: they run before any sign-in (login, password reset, first admin, CheckInvitation and
 *   AcceptInvitation for the link of an invitation, whose signature and row are the only credentials), without an actor
 *   whose rights could be checked (A4, P18).
 * - App\Actions\Setup\*: migrations and console commands set up roles and the default bot, nobody acts.
 * - App\Actions\Accounts\NextHandle: a reading helper that finds a free handle for the actions above, without an actor (P24).
 */

$everyone = MatrixWorld::COLUMNS;

// password and second factor are the own account's, and only people sign in
$people = array_values(array_diff($everyone, ['default_bot']));

/** Starts a two-factor setup for the account past the action (a bot as well, so its refusal is the action's own); returns the secret. */
$startTwoFactor = function (User $user): string {
    app(EnableTwoFactorAuthentication::class)($user, true);

    return decrypt((string) $user->two_factor_secret);
};

/** Turns two-factor sign-in on for the account past the actions. */
$withTwoFactor = function (User $user) use ($startTwoFactor): void {
    $startTwoFactor($user);
    $user->forceFill(['two_factor_confirmed_at' => now()])->save();
};

return [
    'GetOrganization' => [
        'action' => GetOrganization::class,
        'run' => fn (Actor $a, MatrixWorld $w, string $column) => GetOrganization::run($a),
        'allowed' => $everyone,
    ],
    'UpdateOrganization' => [
        'action' => UpdateOrganization::class,
        'run' => fn (Actor $a, MatrixWorld $w, string $column) => UpdateOrganization::run($a, ['name' => 'Neu']),
        'allowed' => ['org_admin', 'default_bot'],
        'event' => EventType::OrganizationUpdated,
    ],
    'ShowMedia' => [
        'action' => ShowMedia::class,
        'run' => fn (Actor $a, MatrixWorld $w, string $column) => ShowMedia::run($a, $w->logo),
        'allowed' => $everyone,
    ],
    'ListUsers' => [
        'action' => ListUsers::class,
        'run' => fn (Actor $a, MatrixWorld $w, string $column) => ListUsers::run($a, []),
        'allowed' => $everyone,
    ],
    'UpdateUser' => [
        'action' => UpdateUser::class,
        'run' => fn (Actor $a, MatrixWorld $w, string $column) => UpdateUser::run($a, $w->target, ['name' => 'Neu']),
        'allowed' => ['org_admin', 'default_bot'],
        'event' => EventType::UserUpdated,
    ],
    'UpdateUserRole' => [
        'action' => UpdateUserRole::class,
        'run' => fn (Actor $a, MatrixWorld $w, string $column) => UpdateUserRole::run($a, $w->target, 'admin'),
        'allowed' => ['org_admin', 'default_bot'],
        'event' => EventType::UserRoleChanged,
    ],
    'DeactivateUser' => [
        'action' => DeactivateUser::class,
        'run' => fn (Actor $a, MatrixWorld $w, string $column) => DeactivateUser::run($a, $w->target),
        'allowed' => ['org_admin', 'default_bot'],
        'event' => EventType::UserDeactivated,
    ],
    'ReactivateUser' => [
        'action' => ReactivateUser::class,
        'run' => function (Actor $a, MatrixWorld $w, string $column) {
            $w->target->update(['disabled_at' => now()]);

            return ReactivateUser::run($a, $w->target);
        },
        'allowed' => ['org_admin', 'default_bot'],
        'event' => EventType::UserReactivated,
    ],
    'CreateBot' => [
        'action' => CreateBot::class,
        // the responsible person named: by default it is the actor, and the default bot is no person
        'run' => fn (Actor $a, MatrixWorld $w, string $column) => CreateBot::run($a, ['name' => 'Neu', 'handle' => 'matrix-neu', 'owner_id' => $w->target->id]),
        'allowed' => ['org_admin', 'default_bot'],
        'event' => EventType::BotCreated,
    ],
    'InviteUser' => [
        'action' => InviteUser::class,
        'run' => fn (Actor $a, MatrixWorld $w, string $column) => InviteUser::run($a, ['email' => "matrix-{$column}@example.com", 'org_role' => 'member']),
        'allowed' => ['org_admin', 'default_bot'],
        'event' => EventType::UserInvited,
    ],
    'ListInvitations' => [
        'action' => ListInvitations::class,
        'run' => fn (Actor $a, MatrixWorld $w, string $column) => ListInvitations::run($a, []),
        'allowed' => ['org_admin', 'default_bot'],
    ],
    'ListTokens' => [
        'action' => ListTokens::class,
        // the tokens of a bot: org admins only (spec 4.2), even the person who runs it may not
        'run' => fn (Actor $a, MatrixWorld $w, string $column) => ListTokens::run($a, $w->bot, []),
        'allowed' => ['org_admin', 'default_bot'],
    ],
    'CreateToken' => [
        'action' => CreateToken::class,
        'run' => fn (Actor $a, MatrixWorld $w, string $column) => CreateToken::run($a, $w->bot, ['name' => 'Matrix', 'abilities' => ['read']]),
        'allowed' => ['org_admin', 'default_bot'],
        'event' => EventType::TokenCreated,
    ],
    'RevokeToken' => [
        'action' => RevokeToken::class,
        'run' => fn (Actor $a, MatrixWorld $w, string $column) => RevokeToken::run($a, $w->bot->createToken('Matrix', ['read'])->accessToken),
        'allowed' => ['org_admin', 'default_bot'],
        'event' => EventType::TokenRevoked,
    ],
    'ChangePassword' => [
        'action' => ChangePassword::class,
        'run' => fn (Actor $a, MatrixWorld $w, string $column) => ChangePassword::run($a, [
            'current_password' => MatrixWorld::PASSWORD, 'password' => 'new-matrix-password', 'password_confirmation' => 'new-matrix-password',
        ]),
        'allowed' => $people,
        'event' => EventType::UserPasswordChanged,
    ],
    'GetTwoFactor' => [
        'action' => GetTwoFactor::class,
        'run' => fn (Actor $a, MatrixWorld $w, string $column) => GetTwoFactor::run($a),
        'allowed' => $people,
    ],
    'EnableTwoFactor' => [
        'action' => EnableTwoFactor::class,
        'run' => fn (Actor $a, MatrixWorld $w, string $column) => EnableTwoFactor::run($a),
        'allowed' => $people,
        'event' => EventType::UserTwoFactorSetupStarted,
    ],
    'ConfirmTwoFactor' => [
        'action' => ConfirmTwoFactor::class,
        'run' => fn (Actor $a, MatrixWorld $w, string $column) => ConfirmTwoFactor::run($a, app(Google2FA::class)->getCurrentOtp($startTwoFactor($a->user))),
        'allowed' => $people,
        'event' => EventType::UserTwoFactorEnabled,
    ],
    'DisableTwoFactor' => [
        'action' => DisableTwoFactor::class,
        'run' => function (Actor $a, MatrixWorld $w, string $column) use ($withTwoFactor) {
            $withTwoFactor($a->user);

            return DisableTwoFactor::run($a);
        },
        'allowed' => $people,
        'event' => EventType::UserTwoFactorDisabled,
    ],
    'RegenerateRecoveryCodes' => [
        'action' => RegenerateRecoveryCodes::class,
        'run' => function (Actor $a, MatrixWorld $w, string $column) use ($withTwoFactor) {
            $withTwoFactor($a->user);

            return RegenerateRecoveryCodes::run($a);
        },
        'allowed' => $people,
        'event' => EventType::UserRecoveryCodesRegenerated,
    ],
];
