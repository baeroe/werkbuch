<?php

namespace App\Mcp\Tools;

use App\Actions\Automations\ListAutomations;
use App\Http\Resources\AutomationResource;
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
 * `automations` (spec 6.2): the five automations of a project, also those never saved. The write is `manage-automations`.
 */
#[IsReadOnly]
#[IsOpenWorld(false)]
final class AutomationsTool extends ReadTool
{
    protected string $name = 'automations';

    protected string $title = 'Automations';

    protected string $description = 'Reads the five automations of a project (`auto_archive`, `auto_close`, `close_parent`, `assign_on_start`, `link_references`) with their settings. A key never saved is off, except `link_references`, which is on.';

    protected function actions(): array
    {
        return [new McpAction(
            name: 'list',
            summary: 'The automations of a project.',
            run: fn (Actor $actor, McpArguments $args): McpResult => McpResult::resource(AutomationResource::collection(ListAutomations::run($actor, References::project($args->reference('project'))))),
            parameters: ['project' => ToolSchema::reference('project')],
            required: ['project'],
            twin: 'GET projects/{project}/automations',
        )];
    }
}
