<?php

namespace App\Mcp\Tools;

use App\Actions\Pages\CreatePage;
use App\Actions\Pages\DeletePage;
use App\Actions\Pages\MovePage;
use App\Actions\Pages\RestorePageVersion;
use App\Actions\Pages\UpdatePage;
use App\Http\Resources\PageResource;
use App\Mcp\Support\McpAction;
use App\Mcp\Support\McpArguments;
use App\Mcp\Support\McpResult;
use App\Mcp\Support\ToolSchema;
use App\Mcp\Support\WriteTool;
use App\OpenApi\OperationsSchemas;
use App\Support\Actor;
use App\Support\References;
use Laravel\Mcp\Server\Tools\Annotations\IsDestructive;
use Laravel\Mcp\Server\Tools\Annotations\IsOpenWorld;
use Laravel\Mcp\Server\Tools\Annotations\IsReadOnly;

/**
 * `manage-pages` (spec 6.2), the pair of `pages`: create, save (`base_version` guards against an overwrite: 409
 * `page_conflict` with the current page as Markdown; `keep_current` keeps the stored state as a version), move,
 * delete a page with its subtree (`{deleted}`; the action runs at READ COMMITTED, the tool opens no transaction) and
 * restore a version.
 */
#[IsDestructive]
#[IsReadOnly(false)]
#[IsOpenWorld(false)]
final class ManagePagesTool extends WriteTool
{
    protected string $name = 'manage-pages';

    protected string $title = 'Manage wiki pages';

    protected string $description = 'Writes wiki pages. `input.content` is Markdown. A save with `input.base_version` that is not the current version is refused '
        .'with 409 `page_conflict` and the current page; `keep_current` keeps the stored state as a version.';

    protected function actions(): array
    {
        $page = ['page' => ToolSchema::reference('page')];

        return [
            new McpAction(
                name: 'create',
                summary: 'A new page at the end of its siblings.',
                run: fn (Actor $actor, McpArguments $args): McpResult => McpResult::resource(new PageResource(CreatePage::run($actor, References::project($args->reference('project')), $args->input()))),
                parameters: ['project' => ToolSchema::reference('project')],
                input: OperationsSchemas::pageCreate(),
                required: ['project', 'input'],
                twin: 'POST projects/{project}/pages',
            ),
            new McpAction(
                name: 'update',
                summary: 'Saves the keys sent.',
                run: fn (Actor $actor, McpArguments $args): McpResult => McpResult::resource(new PageResource(UpdatePage::run($actor, PagesTool::page($args), $args->input()))),
                parameters: $page,
                input: OperationsSchemas::pageUpdate(),
                required: ['page', 'input'],
                twin: 'PATCH pages/{page}',
            ),
            new McpAction(
                name: 'move',
                summary: 'Moves a page with its subtree.',
                run: fn (Actor $actor, McpArguments $args): McpResult => McpResult::resource(new PageResource(MovePage::run($actor, PagesTool::page($args), $args->input()))),
                parameters: $page,
                input: OperationsSchemas::pageMove(),
                required: ['page', 'input'],
                twin: 'POST pages/{page}/move',
            ),
            new McpAction(
                name: 'delete',
                summary: 'Deletes a page with its subtree; answers `{deleted}`.',
                run: fn (Actor $actor, McpArguments $args): McpResult => McpResult::body(['deleted' => DeletePage::run($actor, PagesTool::page($args))]),
                parameters: $page,
                required: ['page'],
                twin: 'DELETE pages/{page}',
            ),
            new McpAction(
                name: 'restore-version',
                summary: 'Makes a kept version the current page.',
                run: fn (Actor $actor, McpArguments $args): McpResult => McpResult::resource(new PageResource(RestorePageVersion::run($actor, PagesTool::page($args), PagesTool::version($args)))),
                parameters: [...$page, 'page_version' => ToolSchema::reference('pageVersion')],
                required: ['page', 'page_version'],
                twin: 'POST pages/{page}/versions/{pageVersion}/restore',
            ),
        ];
    }
}
