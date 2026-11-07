<?php

namespace App\Mcp\Tools;

use App\Actions\Invitations\ListInvitations;
use App\Actions\RichText\ListMentionables;
use App\Actions\Tokens\ListTokens;
use App\Actions\Users\GetUser;
use App\Actions\Users\ListUsers;
use App\Http\Resources\InvitationResource;
use App\Http\Resources\TokenResource;
use App\Http\Resources\UserResource;
use App\Mcp\Support\McpAction;
use App\Mcp\Support\McpArguments;
use App\Mcp\Support\McpResult;
use App\Mcp\Support\ReadTool;
use App\Mcp\Support\ToolSchema;
use App\Models\User;
use App\Support\Actor;
use App\Support\References;
use Laravel\Mcp\Server\Tools\Annotations\IsOpenWorld;
use Laravel\Mcp\Server\Tools\Annotations\IsReadOnly;

/**
 * `people` (spec 6.2): accounts, bots, open invitations, the API tokens of an account and who can be mentioned in a
 * project. The writes are `manage-people`.
 */
#[IsReadOnly]
#[IsOpenWorld(false)]
final class PeopleTool extends ReadTool
{
    protected string $name = 'people';

    protected string $title = 'People';

    protected string $description = 'Reads accounts: people and bots, open invitations, API tokens (the own ones; org admins also those of bots) '
        .'and who can be mentioned in a project. Lists take `filter`, `sort`, `cursor` and `per_page`; `get-user` takes the `id` of the account.';

    protected function actions(): array
    {
        $users = ToolSchema::list(ListUsers::spec());
        $bots = ToolSchema::list(ListUsers::botSpec());
        $invitations = ToolSchema::list(ListInvitations::spec());
        $tokens = ToolSchema::list(ListTokens::spec());

        return [
            new McpAction(
                name: 'list-users',
                summary: 'The accounts, people before bots (`filter.type` takes `person` and `bot`).',
                run: fn (Actor $actor, McpArguments $args): McpResult => McpResult::list(ListUsers::run($actor, $args->query(array_keys($users))), UserResource::class),
                parameters: $users,
                twin: 'GET users',
            ),
            new McpAction(
                name: 'get-user',
                summary: 'One account.',
                run: fn (Actor $actor, McpArguments $args): McpResult => McpResult::resource(new UserResource(GetUser::run($actor, References::ulid(User::class, $args->reference('id'))))),
                parameters: ['id' => ToolSchema::reference('user')],
                required: ['id'],
                twin: 'GET users/{user}',
                path: ['user' => 'id'],
            ),
            new McpAction(
                name: 'list-bots',
                summary: 'The bots.',
                run: fn (Actor $actor, McpArguments $args): McpResult => McpResult::list(ListUsers::run($actor, $args->query(array_keys($bots)), bots: true), UserResource::class),
                parameters: $bots,
                twin: 'GET bots',
            ),
            new McpAction(
                name: 'list-invitations',
                summary: 'The open invitations.',
                run: fn (Actor $actor, McpArguments $args): McpResult => McpResult::list(ListInvitations::run($actor, $args->query(array_keys($invitations))), InvitationResource::class),
                parameters: $invitations,
                twin: 'GET invitations',
            ),
            new McpAction(
                name: 'list-tokens',
                summary: 'The API tokens of the own account, or of the account in `filter.user_id`.',
                run: fn (Actor $actor, McpArguments $args): McpResult => McpResult::list(ListTokens::run($actor, $args->query(array_keys($tokens))), TokenResource::class),
                parameters: $tokens,
                twin: 'GET tokens',
            ),
            new McpAction(
                name: 'mentionable',
                summary: 'Who can be mentioned in a project.',
                run: fn (Actor $actor, McpArguments $args): McpResult => McpResult::resource(UserResource::collection(ListMentionables::run($actor, $args->query(ListMentionables::KEYS)))),
                parameters: [
                    'project' => ['type' => 'string', 'description' => 'The project: ULID, identifier or a former identifier. One the account does not see is 404.'],
                    'q' => ['type' => 'string', 'maxLength' => 64, 'description' => 'Part of a name or handle; word beginnings first, people before bots. Without it everyone who can take work.'],
                    'limit' => ['type' => 'integer', 'minimum' => 1, 'maximum' => ListMentionables::MAX_LIMIT, 'description' => 'The most accounts.'],
                ],
                required: ['project'],
                twin: 'GET mentions',
            ),
        ];
    }
}
