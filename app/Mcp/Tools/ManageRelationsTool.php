<?php

namespace App\Mcp\Tools;

use App\Actions\WorkItems\AddRelation;
use App\Actions\WorkItems\ListRelations;
use App\Actions\WorkItems\RemoveRelation;
use App\Http\Resources\RelationEntryResource;
use App\Mcp\Support\McpAction;
use App\Mcp\Support\McpArguments;
use App\Mcp\Support\McpResult;
use App\Mcp\Support\ToolSchema;
use App\Mcp\Support\WriteTool;
use App\Models\WorkItemRelation;
use App\OpenApi\WorkItemSchemas;
use App\Support\Actor;
use App\Support\References;
use Laravel\Mcp\Server\Tools\Annotations\IsDestructive;
use Laravel\Mcp\Server\Tools\Annotations\IsOpenWorld;
use Laravel\Mcp\Server\Tools\Annotations\IsReadOnly;

/**
 * `manage-relations` (spec 6.2), the pair of `relations`: relate an item to another one and take a relation away. `add`
 * answers the entry as the source reads it (REST: 201), `remove` `{done: true}` (REST: 204).
 */
#[IsDestructive]
#[IsReadOnly(false)]
#[IsOpenWorld(false)]
final class ManageRelationsTool extends WriteTool
{
    protected string $name = 'manage-relations';

    protected string $title = 'Manage relations';

    protected string $description = 'Relates work items. `add` relates `item` (the source) to `input.target_id` (ULID or key); '
        .'`remove` takes a relation away from either end the account may change.';

    protected function actions(): array
    {
        return [
            new McpAction(
                name: 'add',
                summary: 'Relates an item to another one.',
                run: function (Actor $actor, McpArguments $args): McpResult {
                    $item = References::item($args->reference('item'));
                    $relation = AddRelation::run($actor, $item, $args->input());

                    return McpResult::resource(new RelationEntryResource(ListRelations::entry($relation, $item, $actor->user)));
                },
                parameters: ['item' => ToolSchema::reference('item')],
                input: WorkItemSchemas::relation(),
                required: ['item', 'input'],
                twin: 'POST work-items/{item}/relations',
            ),
            new McpAction(
                name: 'remove',
                summary: 'Removes a relation.',
                run: function (Actor $actor, McpArguments $args): McpResult {
                    RemoveRelation::run($actor, References::ulid(WorkItemRelation::class, $args->reference('relation')));

                    return McpResult::done();
                },
                parameters: ['relation' => ToolSchema::reference('relation')],
                required: ['relation'],
                twin: 'DELETE relations/{relation}',
            ),
        ];
    }
}
