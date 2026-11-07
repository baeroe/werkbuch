<?php

namespace App\Mcp\Tools;

use App\Actions\Views\GetView;
use App\Actions\Views\ListViews;
use App\Actions\WorkItems\QueryWorkItems;
use App\Http\Resources\ViewResource;
use App\Http\Resources\WorkItemResource;
use App\Mcp\Support\McpAction;
use App\Mcp\Support\McpArguments;
use App\Mcp\Support\McpResult;
use App\Mcp\Support\ReadTool;
use App\Mcp\Support\ToolSchema;
use App\Models\View;
use App\OpenApi\ItemQueryDocs;
use App\Support\Actor;
use App\Support\References;
use Laravel\Mcp\Server\Tools\Annotations\IsOpenWorld;
use Laravel\Mcp\Server\Tools\Annotations\IsReadOnly;

/**
 * `views` (spec 6.2): the views of the team, one view and its items. `items` reads through `POST work-items/query` with
 * `view_id` (the arguments besides `view` are keys of that body, described as it describes them): the filter, sort and
 * sub-items of the view apply, the page is lean and 25 items unless the call asks for more (K8). The writes are
 * `manage-views`.
 */
#[IsReadOnly]
#[IsOpenWorld(false)]
final class ViewsTool extends ReadTool
{
    /** The keys of the body of `POST work-items/query` that `items` takes as arguments of their own. */
    public const ITEM_KEYS = ['sort', 'show_sub_items', 'include_archived', 'lean', 'cursor', 'per_page'];

    protected string $name = 'views';

    protected string $title = 'Views';

    protected string $description = 'Reads the views of the team: the list, one view and a page of its items. A view is named by `view` (its ULID).';

    protected function actions(): array
    {
        $list = ToolSchema::list(ListViews::spec());
        $view = ['view' => ToolSchema::reference('view')];

        return [
            new McpAction(
                name: 'list',
                summary: 'The views, by name.',
                run: fn (Actor $actor, McpArguments $args): McpResult => McpResult::list(ListViews::run($actor, $args->query(array_keys($list))), ViewResource::class),
                parameters: $list,
                twin: 'GET views',
            ),
            new McpAction(
                name: 'get',
                summary: 'One view with its filter and display.',
                run: fn (Actor $actor, McpArguments $args): McpResult => McpResult::resource(new ViewResource(GetView::run($actor, References::ulid(View::class, $args->reference('view'))))),
                parameters: $view,
                required: ['view'],
                twin: 'GET views/{view}',
            ),
            new McpAction(
                name: 'items',
                summary: 'A page of the items of a view (lean unless `lean` is false).',
                run: fn (Actor $actor, McpArguments $args): McpResult => McpResult::list(QueryWorkItems::run($actor, self::items($args)), WorkItemResource::class),
                parameters: [...$view, ...array_intersect_key(ItemQueryDocs::query()['properties'], array_flip(self::ITEM_KEYS))],
                required: ['view'],
                twin: 'POST work-items/query',
                defaults: ['lean' => true],
                body: self::items(...),
            ),
        ];
    }

    /**
     * The body of `POST work-items/query` for the items of a view: `view_id` and the keys of the body the call names
     * (`null` is a key left out, as the action reads it).
     *
     * @return array<string, mixed>
     */
    public static function items(McpArguments $args): array
    {
        return ['view_id' => $args->reference('view'), ...$args->only(self::ITEM_KEYS)];
    }
}
