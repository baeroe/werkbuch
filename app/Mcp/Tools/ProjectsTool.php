<?php

namespace App\Mcp\Tools;

use App\Actions\Favorites\ListFavorites;
use App\Actions\Projects\GetProject;
use App\Actions\Projects\ListMembers;
use App\Actions\Projects\ListProjects;
use App\Http\Resources\FavoriteResource;
use App\Http\Resources\ProjectMemberResource;
use App\Http\Resources\ProjectResource;
use App\Mcp\Support\McpAction;
use App\Mcp\Support\McpArguments;
use App\Mcp\Support\McpResult;
use App\Mcp\Support\ReadTool;
use App\Mcp\Support\ToolSchema;
use App\Support\Actor;
use App\Support\References;
use Laravel\Mcp\Server\Tools\Annotations\IsOpenWorld;
use Laravel\Mcp\Server\Tools\Annotations\IsReadOnly;

/**
 * `projects` (spec 6.2): the projects the account sees, one project, its members and the own favorites. The writes are
 * `manage-projects`.
 */
#[IsReadOnly]
#[IsOpenWorld(false)]
final class ProjectsTool extends ReadTool
{
    protected string $name = 'projects';

    protected string $title = 'Projects';

    protected string $description = 'Reads projects: the ones the account sees, one project, its members and the own favorites. '
        .'Lists take `filter`, `sort`, `cursor` and `per_page`; a project is named by `project` (ULID, identifier or a former identifier).';

    protected function actions(): array
    {
        $projects = ToolSchema::list(ListProjects::spec());
        $members = ToolSchema::list(ListMembers::spec());
        $favorites = ToolSchema::list(ListFavorites::spec());

        return [
            new McpAction(
                name: 'list',
                summary: 'The projects of the account (`filter.member` only the ones it is a member of; `include` `members`).',
                run: fn (Actor $actor, McpArguments $args): McpResult => McpResult::list(ListProjects::run($actor, $args->query([...array_keys($projects), 'include_archived'])), ProjectResource::class),
                parameters: [
                    ...$projects,
                    'include_archived' => ['type' => 'integer', 'enum' => [1, 0], 'description' => 'Archived projects too (`1`); without it only the active ones.'],
                ],
                twin: 'GET projects',
            ),
            new McpAction(
                name: 'get',
                summary: 'One project. Needs `project`.',
                run: fn (Actor $actor, McpArguments $args): McpResult => McpResult::resource(new ProjectResource(GetProject::run($actor, References::project($args->reference('project'))))),
                parameters: ['project' => ToolSchema::reference('project')],
                required: ['project'],
                twin: 'GET projects/{project}',
            ),
            new McpAction(
                name: 'members',
                summary: 'The members of a project, people and bots with their role. Needs `project`.',
                run: fn (Actor $actor, McpArguments $args): McpResult => McpResult::list(ListMembers::run($actor, References::project($args->reference('project')), $args->query(array_keys($members))), ProjectMemberResource::class),
                parameters: ['project' => ToolSchema::reference('project'), ...$members],
                required: ['project'],
                twin: 'GET projects/{project}/members',
            ),
            new McpAction(
                name: 'favorites',
                summary: 'The own favorites, projects and views in one order.',
                run: fn (Actor $actor, McpArguments $args): McpResult => McpResult::list(ListFavorites::run($actor, $args->query(array_keys($favorites))), FavoriteResource::class),
                parameters: $favorites,
                twin: 'GET favorites',
            ),
        ];
    }
}
