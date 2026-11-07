<?php

namespace App\Mcp\Tools;

use App\Actions\WorkItems\ArchiveWorkItem;
use App\Actions\WorkItems\BulkUpdateWorkItems;
use App\Actions\WorkItems\ChangeWorkItemType;
use App\Actions\WorkItems\CreateWorkItem;
use App\Actions\WorkItems\DeleteWorkItem;
use App\Actions\WorkItems\RestoreWorkItem;
use App\Actions\WorkItems\SetSubscription;
use App\Actions\WorkItems\TransitionWorkItem;
use App\Actions\WorkItems\UpdateWorkItem;
use App\Http\Resources\WorkItemResource;
use App\Mcp\Support\McpAction;
use App\Mcp\Support\McpArguments;
use App\Mcp\Support\McpResult;
use App\Mcp\Support\ToolSchema;
use App\Mcp\Support\WriteTool;
use App\Models\WorkItem;
use App\OpenApi\WorkItemSchemas;
use App\Support\Actor;
use App\Support\References;
use Laravel\Mcp\Server\Tools\Annotations\IsDestructive;
use Laravel\Mcp\Server\Tools\Annotations\IsOpenWorld;
use Laravel\Mcp\Server\Tools\Annotations\IsReadOnly;

/**
 * `manage-work-items` (spec 6.2), the pair of `work-items`: create, change, move, retype, archive, restore and delete
 * an item, change many at once and watch one. A change by a former key acts on the item (no redirect, as over REST);
 * `delete` answers `{done: true}` (REST: 204), `bulk-update` `{updated, rejected}`.
 */
#[IsDestructive]
#[IsReadOnly(false)]
#[IsOpenWorld(false)]
final class ManageWorkItemsTool extends WriteTool
{
    protected string $name = 'manage-work-items';

    protected string $title = 'Manage work items';

    protected string $description = 'Changes work items. An item is named by `item` (ULID or key); a description sent with '
        .'`base_description_version` is refused with 409 and the current item when someone changed it since.';

    protected function actions(): array
    {
        $item = ['item' => ToolSchema::reference('item')];

        return [
            new McpAction(
                name: 'create',
                summary: 'Creates an item.',
                run: function (Actor $actor, McpArguments $args): McpResult {
                    $item = CreateWorkItem::run($actor, $args->input());
                    WorkItem::loadForResource($item, $actor->user);

                    return McpResult::resource(new WorkItemResource($item));
                },
                input: WorkItemSchemas::create(),
                required: ['input'],
                twin: 'POST work-items',
            ),
            new McpAction(
                name: 'update',
                summary: 'Changes the keys of `input`.',
                run: fn (Actor $actor, McpArguments $args): McpResult => McpResult::resource(new WorkItemResource(UpdateWorkItem::run($actor, self::item($args), $args->input()))),
                parameters: $item,
                input: WorkItemSchemas::update(),
                required: ['item', 'input'],
                twin: 'PATCH work-items/{item}',
            ),
            new McpAction(
                name: 'transition',
                summary: 'Moves an item to another state.',
                run: fn (Actor $actor, McpArguments $args): McpResult => McpResult::resource(new WorkItemResource(TransitionWorkItem::run($actor, self::item($args), $args->input()))),
                parameters: $item,
                input: WorkItemSchemas::transition(),
                required: ['item', 'input'],
                twin: 'POST work-items/{item}/transition',
            ),
            new McpAction(
                name: 'change-type',
                summary: 'Gives an item another type.',
                run: fn (Actor $actor, McpArguments $args): McpResult => McpResult::resource(new WorkItemResource(ChangeWorkItemType::run($actor, self::item($args), $args->input()))),
                parameters: $item,
                input: WorkItemSchemas::changeType(),
                required: ['item', 'input'],
                twin: 'PUT work-items/{item}/type',
            ),
            new McpAction(
                name: 'archive',
                summary: 'Archives a closed item.',
                run: fn (Actor $actor, McpArguments $args): McpResult => McpResult::resource(new WorkItemResource(ArchiveWorkItem::run($actor, self::item($args)))),
                parameters: $item,
                required: ['item'],
                twin: 'POST work-items/{item}/archive',
            ),
            new McpAction(
                name: 'restore',
                summary: 'Restores an archived item.',
                run: fn (Actor $actor, McpArguments $args): McpResult => McpResult::resource(new WorkItemResource(RestoreWorkItem::run($actor, self::item($args)))),
                parameters: $item,
                required: ['item'],
                twin: 'POST work-items/{item}/restore',
            ),
            new McpAction(
                name: 'delete',
                summary: 'Deletes an item for good.',
                run: function (Actor $actor, McpArguments $args): McpResult {
                    DeleteWorkItem::run($actor, self::item($args));

                    return McpResult::done();
                },
                parameters: $item,
                required: ['item'],
                twin: 'DELETE work-items/{item}',
            ),
            new McpAction(
                name: 'bulk-update',
                summary: 'One patch for many items.',
                run: fn (Actor $actor, McpArguments $args): McpResult => McpResult::body(BulkUpdateWorkItems::run($actor, $args->input())),
                input: WorkItemSchemas::bulk(),
                required: ['input'],
                twin: 'POST work-items/bulk',
            ),
            new McpAction(
                name: 'subscribe',
                summary: 'Watches an item.',
                run: fn (Actor $actor, McpArguments $args): McpResult => McpResult::resource(new WorkItemResource(SetSubscription::run($actor, self::item($args), true))),
                parameters: $item,
                required: ['item'],
                twin: 'PUT work-items/{item}/subscription',
            ),
            new McpAction(
                name: 'unsubscribe',
                summary: 'Stops watching an item.',
                run: fn (Actor $actor, McpArguments $args): McpResult => McpResult::resource(new WorkItemResource(SetSubscription::run($actor, self::item($args), false))),
                parameters: $item,
                required: ['item'],
                twin: 'DELETE work-items/{item}/subscription',
            ),
        ];
    }

    private static function item(McpArguments $args): WorkItem
    {
        return References::item($args->reference('item'));
    }
}
