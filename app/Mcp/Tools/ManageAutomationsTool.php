<?php

namespace App\Mcp\Tools;

use App\Actions\Automations\SaveAutomation;
use App\Http\Resources\AutomationResource;
use App\Mcp\Support\McpAction;
use App\Mcp\Support\McpArguments;
use App\Mcp\Support\McpResult;
use App\Mcp\Support\ToolSchema;
use App\Mcp\Support\WriteTool;
use App\OpenApi\CatalogSchemas;
use App\Support\Actor;
use App\Support\References;
use Laravel\Mcp\Server\Tools\Annotations\IsDestructive;
use Laravel\Mcp\Server\Tools\Annotations\IsOpenWorld;
use Laravel\Mcp\Server\Tools\Annotations\IsReadOnly;

/**
 * `manage-automations` (spec 6.2), the pair of `automations`: switches one automation of a project by its key and sets
 * its settings. A key that is none is 404 like over REST; the admins of the project may switch.
 */
#[IsDestructive]
#[IsReadOnly(false)]
#[IsOpenWorld(false)]
final class ManageAutomationsTool extends WriteTool
{
    protected string $name = 'manage-automations';

    protected string $title = 'Manage automations';

    protected string $description = 'Switches an automation of a project (its admins).';

    protected function actions(): array
    {
        return [new McpAction(
            name: 'update',
            summary: 'Switches an automation on or off and sets its settings.',
            run: fn (Actor $actor, McpArguments $args): McpResult => McpResult::resource(new AutomationResource(SaveAutomation::run($actor, References::project($args->reference('project')), $args->reference('key'), $args->input()))),
            parameters: [
                'project' => ToolSchema::reference('project'),
                'key' => ToolSchema::reference('key'),
            ],
            input: CatalogSchemas::automation(),
            required: ['project', 'key', 'input'],
            twin: 'PUT projects/{project}/automations/{key}',
        )];
    }
}
