<?php

namespace App\Mcp\Tools;

use App\Actions\WorkItems\CountWorkItems;
use App\Actions\WorkItems\GetWorkItem;
use App\Actions\WorkItems\GroupWorkItems;
use App\Actions\WorkItems\ListHistory;
use App\Actions\WorkItems\ListSubscribers;
use App\Actions\WorkItems\ListWorkItems;
use App\Actions\WorkItems\QueryWorkItems;
use App\Http\Resources\HistoryEntryResource;
use App\Http\Resources\ItemGroupsResource;
use App\Http\Resources\UserResource;
use App\Http\Resources\WorkItemResource;
use App\Mcp\Support\McpAction;
use App\Mcp\Support\McpArguments;
use App\Mcp\Support\McpResult;
use App\Mcp\Support\ReadTool;
use App\Mcp\Support\ToolSchema;
use App\Models\WorkItem;
use App\OpenApi\ItemQueryDocs;
use App\Support\Actor;
use App\Support\References;
use Laravel\Mcp\Server\Tools\Annotations\IsOpenWorld;
use Laravel\Mcp\Server\Tools\Annotations\IsReadOnly;
use stdClass;

/**
 * `work-items` (spec 6.2): lists, queries, groups and counts of work items, one item, its history and its watchers. The
 * writes are `manage-work-items`. A list reads lean items 25 a page unless the call asks for more (K8): `lean` as an
 * argument of `list`, in `input` of `query`. `counts` tells an object of filters from a list by the raw body, as REST
 * does (K12): PHP decodes `{"0": …}` into a list.
 */
#[IsReadOnly]
#[IsOpenWorld(false)]
final class WorkItemsTool extends ReadTool
{
    protected string $name = 'work-items';

    protected string $title = 'Work items';

    protected string $description = 'Reads work items: lists by a view and the short form `filter`, queries by a body, groups and counts, '
        .'one item with what it embeds, its history and its watchers. An item is named by `item` (ULID or key, also a former one).';

    protected function actions(): array
    {
        $list = ToolSchema::query(ItemQueryDocs::queryParameters());
        $history = ToolSchema::list(ListHistory::spec());
        $item = ['item' => ToolSchema::reference('item')];
        $include = ItemQueryDocs::includeParameter();

        return [
            new McpAction(
                name: 'list',
                summary: 'A page of items (lean unless `lean` is 0).',
                run: fn (Actor $actor, McpArguments $args): McpResult => McpResult::list(ListWorkItems::run($actor, $args->query(array_keys($list))), WorkItemResource::class),
                parameters: $list,
                twin: 'GET work-items',
                defaults: ['lean' => 1],
            ),
            new McpAction(
                name: 'query',
                summary: 'A page of items by a filter in `input`.',
                run: fn (Actor $actor, McpArguments $args): McpResult => McpResult::list(QueryWorkItems::run($actor, self::page($args->input())), WorkItemResource::class),
                input: ToolSchema::paged(ItemQueryDocs::query()),
                twin: 'POST work-items/query',
            ),
            new McpAction(
                name: 'groups',
                summary: 'The groups of a query and their numbers.',
                run: fn (Actor $actor, McpArguments $args): McpResult => McpResult::resource(new ItemGroupsResource(GroupWorkItems::run($actor, $args->input()))),
                input: ItemQueryDocs::groups(),
                required: ['input'],
                twin: 'POST work-items/groups',
            ),
            new McpAction(
                name: 'counts',
                summary: 'The number of items of each named filter.',
                run: fn (Actor $actor, McpArguments $args): McpResult => McpResult::body(['data' => (object) CountWorkItems::run($actor, self::filters($args->input()))]),
                input: ItemQueryDocs::counts(),
                required: ['input'],
                twin: 'POST work-items/counts',
            ),
            new McpAction(
                name: 'get',
                summary: 'One item; `include` embeds more.',
                run: fn (Actor $actor, McpArguments $args): McpResult => McpResult::resource(new WorkItemResource(GetWorkItem::run($actor, self::item($args), self::includes($args)))),
                parameters: [...$item, 'include' => [...$include['schema'], 'description' => $include['description']]],
                required: ['item'],
                twin: 'GET work-items/{item}',
            ),
            new McpAction(
                name: 'history',
                summary: 'The history of an item, oldest first.',
                run: fn (Actor $actor, McpArguments $args): McpResult => McpResult::list(ListHistory::run($actor, self::item($args), $args->query(array_keys($history))), HistoryEntryResource::class),
                parameters: [...$item, ...$history],
                required: ['item'],
                twin: 'GET work-items/{item}/history',
            ),
            new McpAction(
                name: 'subscribers',
                summary: 'Who watches an item.',
                run: fn (Actor $actor, McpArguments $args): McpResult => McpResult::resource(UserResource::collection(ListSubscribers::run($actor, self::item($args)))),
                parameters: $item,
                required: ['item'],
                twin: 'GET work-items/{item}/subscribers',
            ),
        ];
    }

    private static function item(McpArguments $args): WorkItem
    {
        return References::item($args->reference('item'));
    }

    /**
     * `include` as the controller reads its query: comma text (a list arrives as one), else what came.
     *
     * @return array<array-key, mixed>
     */
    private static function includes(McpArguments $args): array
    {
        $include = $args->query(['include'])['include'] ?? [];

        return is_string($include) ? explode(',', $include) : (array) $include;
    }

    /**
     * The body of a query with the page of MCP (K8): lean items, 25 a page, unless the body says otherwise (`null` is a
     * key left out, as the action reads it).
     *
     * @param  array<string, mixed>  $input
     * @return array<string, mixed>
     */
    private static function page(array $input): array
    {
        $input['lean'] ??= true;
        $input['per_page'] ??= McpAction::PER_PAGE;

        return $input;
    }

    /**
     * The body of `counts` with `filters` an object when the raw body sends one (K12, K17 of phase 12): the values stay
     * those of the clean arguments; a list stays a list, which the action refuses like REST.
     *
     * @param  array<string, mixed>  $input
     * @return array<string, mixed>
     */
    private static function filters(array $input): array
    {
        $node = json_decode((string) request()->getContent());
        foreach (['params', 'arguments', 'input', 'filters'] as $key) {
            $node = $node instanceof stdClass ? ($node->{$key} ?? null) : null;
        }
        if ($node instanceof stdClass && is_array($input['filters'] ?? null)) {
            $input['filters'] = (object) $input['filters'];
        }

        return $input;
    }
}
