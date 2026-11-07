<?php

namespace App\Mcp\Tools;

use App\Actions\Views\DeleteView;
use App\Actions\Views\SaveView;
use App\Http\Resources\ViewResource;
use App\Mcp\Support\McpAction;
use App\Mcp\Support\McpArguments;
use App\Mcp\Support\McpResult;
use App\Mcp\Support\ToolSchema;
use App\Mcp\Support\WriteTool;
use App\Models\View;
use App\OpenApi\ContentSchemas;
use App\Support\Actor;
use App\Support\References;
use Laravel\Mcp\Server\Tools\Annotations\IsDestructive;
use Laravel\Mcp\Server\Tools\Annotations\IsOpenWorld;
use Laravel\Mcp\Server\Tools\Annotations\IsReadOnly;

/**
 * `manage-views` (spec 6.2), the pair of `views`: create a view, replace one as a whole and delete one. A view changes
 * and goes only by its creator or an org admin (403 `view_creator_only` names both); `delete` answers `{done: true}`
 * (REST: 204).
 */
#[IsDestructive]
#[IsReadOnly(false)]
#[IsOpenWorld(false)]
final class ManageViewsTool extends WriteTool
{
    protected string $name = 'manage-views';

    protected string $title = 'Manage views';

    protected string $description = 'Changes the views of the team. A view is named by `view` (its ULID); `update` replaces it as a whole.';

    protected function actions(): array
    {
        $view = ['view' => ToolSchema::reference('view')];

        return [
            new McpAction(
                name: 'create',
                summary: 'Creates a view.',
                run: fn (Actor $actor, McpArguments $args): McpResult => McpResult::resource(new ViewResource(SaveView::run($actor, $args->input()))),
                input: ContentSchemas::view(),
                required: ['input'],
                twin: 'POST views',
            ),
            new McpAction(
                name: 'update',
                summary: 'Replaces a view (all four keys).',
                run: fn (Actor $actor, McpArguments $args): McpResult => McpResult::resource(new ViewResource(SaveView::run($actor, $args->input(), self::view($args)))),
                parameters: $view,
                input: ContentSchemas::view(),
                required: ['view', 'input'],
                twin: 'PUT views/{view}',
            ),
            new McpAction(
                name: 'delete',
                summary: 'Deletes a view and the stars of everyone on it.',
                run: function (Actor $actor, McpArguments $args): McpResult {
                    DeleteView::run($actor, self::view($args));

                    return McpResult::done();
                },
                parameters: $view,
                required: ['view'],
                twin: 'DELETE views/{view}',
            ),
        ];
    }

    private static function view(McpArguments $args): View
    {
        return References::ulid(View::class, $args->reference('view'));
    }
}
