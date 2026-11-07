<?php

namespace App\Mcp\Tools;

use App\Actions\Invitations\InviteUser;
use App\Actions\Tokens\RevokeToken;
use App\Actions\Users\CreateBot;
use App\Actions\Users\DeactivateUser;
use App\Actions\Users\ReactivateUser;
use App\Actions\Users\UpdateUser;
use App\Actions\Users\UpdateUserRole;
use App\Http\Resources\InvitationResource;
use App\Http\Resources\UserResource;
use App\Mcp\Support\McpAction;
use App\Mcp\Support\McpArguments;
use App\Mcp\Support\McpResult;
use App\Mcp\Support\ToolSchema;
use App\Mcp\Support\WriteTool;
use App\Models\PersonalAccessToken;
use App\Models\User;
use App\OpenApi\AccountSchemas;
use App\Support\Actor;
use App\Support\InvitationLinks;
use App\Support\References;
use Laravel\Mcp\Server\Tools\Annotations\IsDestructive;
use Laravel\Mcp\Server\Tools\Annotations\IsOpenWorld;
use Laravel\Mcp\Server\Tools\Annotations\IsReadOnly;

/**
 * `manage-people` (spec 6.2), the pair of `people`: change an account, its role, (de)activate it, create a bot, invite
 * an address and revoke a token. No token is created here: that is the session of the web app alone (P6), and so is a
 * new e-mail address (`update-user` answers 403 `session_required`, A55).
 */
#[IsDestructive]
#[IsReadOnly(false)]
#[IsOpenWorld(false)]
final class ManagePeopleTool extends WriteTool
{
    protected string $name = 'manage-people';

    protected string $title = 'Manage people';

    protected string $description = 'Changes accounts: profile, role, (de)activation, bots, invitations and revoking a token. '
        .'Most actions are for org admins; a new e-mail address only comes from the web app (403 `session_required`).';

    protected function actions(): array
    {
        return [
            new McpAction(
                name: 'update-user',
                summary: 'Changes a profile; only the keys named change.',
                run: fn (Actor $actor, McpArguments $args): McpResult => McpResult::resource(new UserResource(UpdateUser::run($actor, self::user($args), $args->input()))),
                parameters: ['id' => ToolSchema::reference('user')],
                input: AccountSchemas::user(),
                required: ['id', 'input'],
                twin: 'PATCH users/{user}',
                path: ['user' => 'id'],
            ),
            new McpAction(
                name: 'set-role',
                summary: 'Sets the role in the organization (`org_role`).',
                run: fn (Actor $actor, McpArguments $args): McpResult => McpResult::resource(new UserResource(UpdateUserRole::run($actor, self::user($args), $args->input()['org_role'] ?? null))),
                parameters: ['id' => ToolSchema::reference('user')],
                input: AccountSchemas::role(),
                required: ['id', 'input'],
                twin: 'PUT users/{user}/role',
                path: ['user' => 'id'],
            ),
            new McpAction(
                name: 'deactivate',
                summary: 'Deactivates an account; its tokens and sessions end.',
                run: fn (Actor $actor, McpArguments $args): McpResult => McpResult::resource(new UserResource(DeactivateUser::run($actor, self::user($args)))),
                parameters: ['id' => ToolSchema::reference('user')],
                required: ['id'],
                twin: 'POST users/{user}/deactivate',
                path: ['user' => 'id'],
            ),
            new McpAction(
                name: 'reactivate',
                summary: 'Reactivates an account; tokens do not come back.',
                run: fn (Actor $actor, McpArguments $args): McpResult => McpResult::resource(new UserResource(ReactivateUser::run($actor, self::user($args)))),
                parameters: ['id' => ToolSchema::reference('user')],
                required: ['id'],
                twin: 'POST users/{user}/reactivate',
                path: ['user' => 'id'],
            ),
            new McpAction(
                name: 'create-bot',
                summary: 'Creates a bot.',
                run: fn (Actor $actor, McpArguments $args): McpResult => McpResult::resource(new UserResource(CreateBot::run($actor, $args->input()))),
                input: AccountSchemas::bot(),
                required: ['input'],
                twin: 'POST bots',
            ),
            new McpAction(
                name: 'invite',
                summary: 'Invites an address; answers `{link, invitation}`.',
                run: function (Actor $actor, McpArguments $args): McpResult {
                    $invitation = InviteUser::run($actor, $args->input());

                    return McpResult::body(['link' => InvitationLinks::for($invitation), 'invitation' => new InvitationResource($invitation)]);
                },
                input: AccountSchemas::invitation(),
                required: ['input'],
                twin: 'POST invitations',
            ),
            new McpAction(
                name: 'revoke-token',
                summary: 'Revokes an API token.',
                run: function (Actor $actor, McpArguments $args): McpResult {
                    RevokeToken::run($actor, References::ulid(PersonalAccessToken::class, $args->reference('id')));

                    return McpResult::done();
                },
                parameters: ['id' => ToolSchema::reference('token')],
                required: ['id'],
                twin: 'DELETE tokens/{token}',
                path: ['token' => 'id'],
            ),
        ];
    }

    private static function user(McpArguments $args): User
    {
        /** @var User */
        return References::ulid(User::class, $args->reference('id'));
    }
}
