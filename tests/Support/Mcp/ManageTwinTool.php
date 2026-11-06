<?php

namespace Tests\Support\Mcp;

use App\Actions\Labels\SaveLabel;
use App\Actions\Views\DeleteView;
use App\Actions\Views\SaveView;
use App\Http\Resources\LabelResource;
use App\Http\Resources\ViewResource;
use App\Mcp\Support\McpAction;
use App\Mcp\Support\McpArguments;
use App\Mcp\Support\McpResult;
use App\Mcp\Support\ToolSchema;
use App\Mcp\Support\WriteTool;
use App\Models\View;
use App\OpenApi\CatalogSchemas;
use App\OpenApi\ContentSchemas;
use App\Support\Actor;
use App\Support\References;
use Laravel\Mcp\Server\Tools\Annotations\IsDestructive;
use Laravel\Mcp\Server\Tools\Annotations\IsOpenWorld;
use Laravel\Mcp\Server\Tools\Annotations\IsReadOnly;

/**
 * The write tool of the twin server: two bodies (`POST views`, `POST labels`) and a delete (`DELETE views/{view}`).
 */
#[IsDestructive]
#[IsReadOnly(false)]
#[IsOpenWorld(false)]
final class ManageTwinTool extends WriteTool
{
    protected string $name = 'manage-twins';

    protected string $title = 'Manage twins';

    protected function actions(): array
    {
        return [
            new McpAction(
                'create-view', 'Creates a view.',
                fn (Actor $actor, McpArguments $args): McpResult => McpResult::resource(new ViewResource(SaveView::run($actor, $args->input()))),
                input: ContentSchemas::view(),
                required: ['input'],
                twin: 'POST views',
            ),
            new McpAction(
                'create-label', 'Creates a label.',
                fn (Actor $actor, McpArguments $args): McpResult => McpResult::resource(new LabelResource(SaveLabel::run($actor, null, $args->input()))),
                input: CatalogSchemas::label(),
                required: ['input'],
                twin: 'POST labels',
            ),
            new McpAction(
                'delete-view', 'Deletes a view.',
                function (Actor $actor, McpArguments $args): McpResult {
                    /** @var View $view */
                    $view = References::ulid(View::class, $args->reference('view'));
                    DeleteView::run($actor, $view);

                    return McpResult::done();
                },
                parameters: ['view' => ToolSchema::reference('view')],
                required: ['view'],
                twin: 'DELETE views/{view}',
            ),
        ];
    }
}
