<?php

namespace App\Mcp\Tools;

use App\Actions\WorkItems\ListRelations;
use App\Http\Resources\RelationEntryResource;
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
 * `relations` (spec 6.2): the relations of a work item as it reads them. An end in a project the account does not see is
 * `hidden`, without key, title or ULID (P19), as over REST. The writes are `manage-relations`.
 */
#[IsReadOnly]
#[IsOpenWorld(false)]
final class RelationsTool extends ReadTool
{
    protected string $name = 'relations';

    protected string $title = 'Relations';

    protected string $description = 'Reads the relations of a work item, by type: the other end, the direction, and `hidden` for an end in a project the account does not see.';

    protected function actions(): array
    {
        return [new McpAction(
            name: 'list',
            summary: 'The relations of an item.',
            run: fn (Actor $actor, McpArguments $args): McpResult => McpResult::resource(RelationEntryResource::collection(ListRelations::run($actor, References::item($args->reference('item'))))),
            parameters: ['item' => ToolSchema::reference('item')],
            required: ['item'],
            twin: 'GET work-items/{item}/relations',
        )];
    }
}
