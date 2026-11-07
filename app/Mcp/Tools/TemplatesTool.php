<?php

namespace App\Mcp\Tools;

use App\Actions\Templates\DraftFromTemplate;
use App\Actions\Templates\GetTemplate;
use App\Actions\Templates\ListTemplateRuns;
use App\Actions\Templates\ListTemplates;
use App\Actions\Templates\PreviewSchedule;
use App\Http\Resources\TemplateDraftResource;
use App\Http\Resources\TemplateResource;
use App\Http\Resources\TemplateRunResource;
use App\Mcp\Support\McpAction;
use App\Mcp\Support\McpArguments;
use App\Mcp\Support\McpResult;
use App\Mcp\Support\ReadTool;
use App\Mcp\Support\ToolSchema;
use App\Models\Template;
use App\OpenApi\ListFlags;
use App\OpenApi\OperationsSchemas;
use App\Support\Actor;
use App\Support\References;
use Laravel\Mcp\Server\Tools\Annotations\IsOpenWorld;
use Laravel\Mcp\Server\Tools\Annotations\IsReadOnly;

/**
 * `templates` (spec 6.2): the templates the account sees (lean unless the call asks for the texts, K8), one template,
 * its runs, the draft of an item from it and a preview of a schedule. The writes are `manage-templates`.
 */
#[IsReadOnly]
#[IsOpenWorld(false)]
final class TemplatesTool extends ReadTool
{
    protected string $name = 'templates';

    protected string $title = 'Templates';

    protected string $description = 'Reads templates of items: the list (`filter.project_id` narrows it, lean unless `lean` is 0), one template, its runs, '
        .'the draft of an item from it and the next terms of a schedule.';

    protected function actions(): array
    {
        $list = ToolSchema::list(ListTemplates::spec());
        $runs = ToolSchema::list(ListTemplateRuns::spec());
        $template = ['template' => ToolSchema::reference('template')];

        return [
            new McpAction(
                name: 'list',
                summary: 'A page of the templates of every project the account sees.',
                run: fn (Actor $actor, McpArguments $args): McpResult => McpResult::list(ListTemplates::run($actor, null, $args->query([...array_keys($list), 'lean'])), TemplateResource::class),
                parameters: [
                    ...$list,
                    'lean' => [...ListFlags::QUERY_FLAG, 'description' => ListFlags::LEAN],
                ],
                twin: 'GET templates',
                defaults: ['lean' => 1],
            ),
            new McpAction(
                name: 'get',
                summary: 'One template.',
                run: fn (Actor $actor, McpArguments $args): McpResult => McpResult::resource(new TemplateResource(GetTemplate::run($actor, self::template($args)))),
                parameters: $template,
                required: ['template'],
                twin: 'GET templates/{template}',
            ),
            new McpAction(
                name: 'runs',
                summary: 'The runs of a template, newest first.',
                run: fn (Actor $actor, McpArguments $args): McpResult => McpResult::list(ListTemplateRuns::run($actor, self::template($args), $args->query(array_keys($runs))), TemplateRunResource::class),
                parameters: [...$template, ...$runs],
                required: ['template'],
                twin: 'GET templates/{template}/runs',
            ),
            new McpAction(
                name: 'draft',
                summary: 'The fields of a new item from a template, placeholders filled.',
                run: fn (Actor $actor, McpArguments $args): McpResult => McpResult::resource(new TemplateDraftResource(DraftFromTemplate::run($actor, self::template($args)))),
                parameters: $template,
                required: ['template'],
                twin: 'GET templates/{template}/draft',
            ),
            new McpAction(
                name: 'preview',
                summary: 'The next terms of a schedule and a title with its placeholders filled; saves nothing.',
                run: fn (Actor $actor, McpArguments $args): McpResult => McpResult::body(['data' => PreviewSchedule::run($actor, $args->input())]),
                input: OperationsSchemas::preview(),
                required: ['input'],
                twin: 'POST templates/preview',
            ),
        ];
    }

    public static function template(McpArguments $args): Template
    {
        return References::ulid(Template::class, $args->reference('template'));
    }
}
