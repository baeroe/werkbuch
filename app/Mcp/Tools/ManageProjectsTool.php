<?php

namespace App\Mcp\Tools;

use App\Actions\Favorites\ToggleFavorite;
use App\Actions\Projects\AddMember;
use App\Actions\Projects\ArchiveProject;
use App\Actions\Projects\AssignWorkflow;
use App\Actions\Projects\CreateProject;
use App\Actions\Projects\DeleteProject;
use App\Actions\Projects\JoinProject;
use App\Actions\Projects\RemoveMember;
use App\Actions\Projects\UpdateMemberRole;
use App\Actions\Projects\UpdateProject;
use App\Actions\WorkItems\RedistributeRanks;
use App\Http\Resources\ProjectMemberResource;
use App\Http\Resources\ProjectResource;
use App\Mcp\Support\McpAction;
use App\Mcp\Support\McpArguments;
use App\Mcp\Support\McpResult;
use App\Mcp\Support\ToolSchema;
use App\Mcp\Support\WriteTool;
use App\Models\Project;
use App\Models\User;
use App\OpenApi\CatalogSchemas;
use App\Support\Actor;
use App\Support\References;
use Laravel\Mcp\Server\Tools\Annotations\IsDestructive;
use Laravel\Mcp\Server\Tools\Annotations\IsOpenWorld;
use Laravel\Mcp\Server\Tools\Annotations\IsReadOnly;

/**
 * `manage-projects` (spec 6.2), the pair of `projects`: create, change, archive, restore and delete a project, switch
 * its workflow, give its items new short ranks (A448), join it, manage its members and toggle a favorite. `delete`
 * answers `{done: true}` (REST: 202 without a body); `set-workflow` without a state for every state in use is 422 with
 * `states`.
 */
#[IsDestructive]
#[IsReadOnly(false)]
#[IsOpenWorld(false)]
final class ManageProjectsTool extends WriteTool
{
    protected string $name = 'manage-projects';

    protected string $title = 'Manage projects';

    protected string $description = 'Changes projects, their members and the own favorites. A project is named by `project`; '
        .'what an action needs is named in its line. The admins of a project change it; deleting is final.';

    protected function actions(): array
    {
        $project = ['project' => ToolSchema::reference('project')];
        $member = [...$project, 'user' => ToolSchema::reference('user')];

        return [
            new McpAction(
                name: 'create',
                summary: 'Creates a project; the account becomes its admin.',
                run: fn (Actor $actor, McpArguments $args): McpResult => McpResult::resource(new ProjectResource(CreateProject::run($actor, $args->input()))),
                input: CatalogSchemas::projectCreate(),
                required: ['input'],
                twin: 'POST projects',
            ),
            new McpAction(
                name: 'update',
                summary: 'Changes a project; only the keys named change.',
                run: fn (Actor $actor, McpArguments $args): McpResult => McpResult::resource(new ProjectResource(UpdateProject::run($actor, self::project($args), $args->input()))),
                parameters: $project,
                input: CatalogSchemas::projectUpdate(),
                required: ['project', 'input'],
                twin: 'PATCH projects/{project}',
            ),
            new McpAction(
                name: 'archive',
                summary: 'Archives a project; its items are read-only.',
                run: fn (Actor $actor, McpArguments $args): McpResult => McpResult::resource(new ProjectResource(ArchiveProject::run($actor, self::project($args)))),
                parameters: $project,
                required: ['project'],
                twin: 'POST projects/{project}/archive',
            ),
            new McpAction(
                name: 'restore',
                summary: 'Restores an archived project.',
                run: fn (Actor $actor, McpArguments $args): McpResult => McpResult::resource(new ProjectResource(ArchiveProject::run($actor, self::project($args), false))),
                parameters: $project,
                required: ['project'],
                twin: 'POST projects/{project}/restore',
            ),
            new McpAction(
                name: 'delete',
                summary: 'Deletes a project at once for everybody; its data goes in the background.',
                run: function (Actor $actor, McpArguments $args): McpResult {
                    DeleteProject::run($actor, self::project($args));

                    return McpResult::done();
                },
                parameters: $project,
                required: ['project'],
                twin: 'DELETE projects/{project}',
            ),
            new McpAction(
                name: 'set-workflow',
                summary: 'Switches the workflow; every state in use needs a state in `mapping`, else 422 with `states`.',
                run: fn (Actor $actor, McpArguments $args): McpResult => McpResult::resource(new ProjectResource(AssignWorkflow::run($actor, self::project($args), $args->input()))),
                parameters: $project,
                input: CatalogSchemas::projectWorkflow(),
                required: ['project', 'input'],
                twin: 'PUT projects/{project}/workflow',
            ),
            new McpAction(
                name: 'redistribute-ranks',
                summary: 'Gives the items new short ranks in their order; answers `{redistributed}`.',
                run: fn (Actor $actor, McpArguments $args): McpResult => McpResult::body(['redistributed' => RedistributeRanks::run($actor, self::project($args))]),
                parameters: $project,
                required: ['project'],
                twin: 'POST projects/{project}/redistribute-ranks',
            ),
            new McpAction(
                name: 'join',
                summary: 'Joins a project as a member.',
                run: fn (Actor $actor, McpArguments $args): McpResult => McpResult::resource(new ProjectMemberResource(JoinProject::run($actor, self::project($args)))),
                parameters: $project,
                required: ['project'],
                twin: 'POST projects/{project}/join',
            ),
            new McpAction(
                name: 'add-member',
                summary: 'Adds an account with a role.',
                run: fn (Actor $actor, McpArguments $args): McpResult => McpResult::resource(new ProjectMemberResource(AddMember::run($actor, self::project($args), $args->input()))),
                parameters: $project,
                input: CatalogSchemas::memberAdd(),
                required: ['project', 'input'],
                twin: 'POST projects/{project}/members',
            ),
            new McpAction(
                name: 'update-member',
                summary: 'Changes the role of a member.',
                run: fn (Actor $actor, McpArguments $args): McpResult => McpResult::resource(new ProjectMemberResource(UpdateMemberRole::run($actor, self::project($args), self::user($args), is_string($args->input()['role'] ?? null) ? $args->input()['role'] : ''))),
                parameters: $member,
                input: CatalogSchemas::memberRole(),
                required: ['project', 'user', 'input'],
                twin: 'PATCH projects/{project}/members/{user}',
            ),
            new McpAction(
                name: 'remove-member',
                summary: 'Removes a member; the lead stays.',
                run: function (Actor $actor, McpArguments $args): McpResult {
                    RemoveMember::run($actor, self::project($args), self::user($args));

                    return McpResult::done();
                },
                parameters: $member,
                required: ['project', 'user'],
                twin: 'DELETE projects/{project}/members/{user}',
            ),
            new McpAction(
                name: 'toggle-favorite',
                summary: 'Puts a project or view into the own favorites or takes it out; answers `{kind, id, favorite}`.',
                run: fn (Actor $actor, McpArguments $args): McpResult => McpResult::body(ToggleFavorite::run($actor, $args->input())),
                input: CatalogSchemas::favoriteToggle(),
                required: ['input'],
                twin: 'POST favorites/toggle',
            ),
        ];
    }

    private static function project(McpArguments $args): Project
    {
        return References::project($args->reference('project'));
    }

    private static function user(McpArguments $args): User
    {
        /** @var User */
        return References::ulid(User::class, $args->reference('user'));
    }
}
