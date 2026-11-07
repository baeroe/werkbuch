<?php

namespace Tests\Support\Mcp;

use App\Actions\Projects\ListMembers;
use App\Actions\Users\ListUsers;
use App\Actions\WorkItems\GroupWorkItems;
use App\Actions\WorkItems\QueryWorkItems;
use App\Http\Resources\ItemGroupsResource;
use App\Http\Resources\ProjectMemberResource;
use App\Http\Resources\UserResource;
use App\Http\Resources\WorkItemResource;
use App\Mcp\Support\McpAction;
use App\Mcp\Support\McpArguments;
use App\Mcp\Support\McpResult;
use App\Mcp\Support\ReadTool;
use App\Mcp\Support\ToolSchema;
use App\OpenApi\ItemQueryDocs;
use App\Support\Actor;
use App\Support\References;
use Laravel\Mcp\Server\Tools\Annotations\IsOpenWorld;
use Laravel\Mcp\Server\Tools\Annotations\IsReadOnly;

/**
 * The read tool of the twin server: a list with filters (`GET users`), a list of a project (`GET
 * projects/{project}/members`) and two reads through a body (`POST work-items/query`, `POST work-items/groups`).
 */
#[IsReadOnly]
#[IsOpenWorld(false)]
final class TwinTool extends ReadTool
{
    protected string $name = 'twins';

    protected string $title = 'Twins';

    protected function actions(): array
    {
        $users = ToolSchema::list(ListUsers::spec());
        $members = ['project' => ToolSchema::reference('project'), ...ToolSchema::list(ListMembers::spec())];

        return [
            new McpAction(
                'list-users', 'The accounts.',
                fn (Actor $actor, McpArguments $args): McpResult => McpResult::list(ListUsers::run($actor, $args->query(array_keys($users))), UserResource::class),
                parameters: $users,
                twin: 'GET users',
            ),
            new McpAction(
                'members', 'The members of a project.',
                fn (Actor $actor, McpArguments $args): McpResult => McpResult::list(
                    ListMembers::run($actor, References::project($args->reference('project')), $args->query(array_keys($members))),
                    ProjectMemberResource::class,
                ),
                parameters: $members,
                required: ['project'],
                twin: 'GET projects/{project}/members',
            ),
            new McpAction(
                'query', 'A page of work items.',
                fn (Actor $actor, McpArguments $args): McpResult => McpResult::list(QueryWorkItems::run($actor, $args->input()), WorkItemResource::class),
                input: ItemQueryDocs::query(),
                twin: 'POST work-items/query',
            ),
            new McpAction(
                'groups', 'The groups of work items.',
                fn (Actor $actor, McpArguments $args): McpResult => McpResult::resource(new ItemGroupsResource(GroupWorkItems::run($actor, $args->input()))),
                input: ItemQueryDocs::groups(),
                required: ['input'],
                twin: 'POST work-items/groups',
            ),
        ];
    }
}
