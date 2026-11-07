<?php

namespace App\Mcp\Tools;

use App\Actions\Notifications\GetNotificationPreferences;
use App\Actions\Notifications\ListNotifications;
use App\Http\Resources\NotificationPreferenceResource;
use App\Http\Resources\NotificationResource;
use App\Mcp\Support\McpAction;
use App\Mcp\Support\McpArguments;
use App\Mcp\Support\McpResult;
use App\Mcp\Support\ReadTool;
use App\Mcp\Support\ToolSchema;
use App\Support\Actor;
use Laravel\Mcp\Server\Tools\Annotations\IsOpenWorld;
use Laravel\Mcp\Server\Tools\Annotations\IsReadOnly;

/**
 * `notifications` (spec 6.2): the own inbox, newest first, and the own notification settings. A bot has an empty inbox.
 * The writes are `manage-notifications`.
 */
#[IsReadOnly]
#[IsOpenWorld(false)]
final class NotificationsTool extends ReadTool
{
    protected string $name = 'notifications';

    protected string $title = 'Notifications';

    protected string $description = 'Reads the own inbox (`filter.unread`, `filter.event`) and the own notification settings.';

    protected function actions(): array
    {
        $list = ToolSchema::list(ListNotifications::spec());

        return [
            new McpAction(
                name: 'list',
                summary: 'A page of the own inbox, newest first.',
                run: fn (Actor $actor, McpArguments $args): McpResult => McpResult::list(ListNotifications::run($actor, $args->query(array_keys($list))), NotificationResource::class),
                parameters: $list,
                twin: 'GET notifications',
            ),
            new McpAction(
                name: 'preferences',
                summary: 'The whole matrix of kinds and channels with the value that counts.',
                run: fn (Actor $actor, McpArguments $args): McpResult => McpResult::resource(NotificationPreferenceResource::collection(GetNotificationPreferences::run($actor))),
                twin: 'GET notification-preferences',
            ),
        ];
    }
}
