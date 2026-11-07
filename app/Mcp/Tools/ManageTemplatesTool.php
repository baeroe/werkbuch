<?php

namespace App\Mcp\Tools;

use App\Actions\Templates\DeleteTemplate;
use App\Actions\Templates\RunTemplate;
use App\Actions\Templates\SaveTemplate;
use App\Http\Resources\TemplateResource;
use App\Http\Resources\TemplateRunResultResource;
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
 * `manage-templates` (spec 6.2), the pair of `templates`: create in a project, replace as a whole, delete (the action
 * runs at READ COMMITTED, the tool opens no transaction) and run now. A run that fails is still an answer: the run with
 * its sentence and no item (A350).
 */
#[IsDestructive]
#[IsReadOnly(false)]
#[IsOpenWorld(false)]
final class ManageTemplatesTool extends WriteTool
{
    protected string $name = 'manage-templates';

    protected string $title = 'Manage templates';

    protected string $description = 'Writes templates of items. `update` replaces the template as a whole, so `input` holds `name`, `payload` and `schedule`. '
        .'`run` makes an item now; a failed run is answered with its sentence.';

    protected function actions(): array
    {
        $template = ['template' => ToolSchema::reference('template')];

        return [
            new McpAction(
                name: 'create',
                summary: 'A new template in a project.',
                run: fn (Actor $actor, McpArguments $args): McpResult => McpResult::resource(new TemplateResource(SaveTemplate::run($actor, References::project($args->reference('project')), $args->input()))),
                parameters: ['project' => ToolSchema::reference('project')],
                input: OperationsSchemas::template(),
                required: ['project', 'input'],
                twin: 'POST projects/{project}/templates',
            ),
            new McpAction(
                name: 'update',
                summary: 'Replaces a template as a whole.',
                run: fn (Actor $actor, McpArguments $args): McpResult => McpResult::resource(new TemplateResource(SaveTemplate::run($actor, null, $args->input(), TemplatesTool::template($args)))),
                parameters: $template,
                input: OperationsSchemas::template(),
                required: ['template', 'input'],
                twin: 'PUT templates/{template}',
            ),
            new McpAction(
                name: 'delete',
                summary: 'Deletes a template; items made from it stay.',
                run: function (Actor $actor, McpArguments $args): McpResult {
                    DeleteTemplate::run($actor, TemplatesTool::template($args));

                    return McpResult::done();
                },
                parameters: $template,
                required: ['template'],
                twin: 'DELETE templates/{template}',
            ),
            new McpAction(
                name: 'run',
                summary: 'Runs a template now; answers the run and its item (none when the run failed).',
                run: fn (Actor $actor, McpArguments $args): McpResult => McpResult::resource(new TemplateRunResultResource(RunTemplate::run($actor, TemplatesTool::template($args)))),
                parameters: $template,
                required: ['template'],
                twin: 'POST templates/{template}/run',
            ),
        ];
    }
}
