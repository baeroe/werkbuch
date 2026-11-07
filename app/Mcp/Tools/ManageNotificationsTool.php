<?php

namespace App\Mcp\Tools;

use App\Actions\Notifications\DeleteNotification;
use App\Actions\Notifications\MarkNotificationsRead;
use App\Actions\Notifications\MarkNotificationsUnread;
use App\Actions\Notifications\SaveNotificationPreferences;
use App\Http\Resources\NotificationPreferenceResource;
use App\Mcp\Support\McpAction;
use App\Mcp\Support\McpArguments;
use App\Mcp\Support\McpResult;
use App\Mcp\Support\ToolSchema;
use App\Mcp\Support\WriteTool;
use App\Models\Notification;
use App\OpenApi\OperationsSchemas;
use App\Support\Actor;
use App\Support\References;
use Laravel\Mcp\Server\Tools\Annotations\IsDestructive;
use Laravel\Mcp\Server\Tools\Annotations\IsOpenWorld;
use Laravel\Mcp\Server\Tools\Annotations\IsReadOnly;

/**
 * `manage-notifications` (spec 6.2), the pair of `notifications`: mark read or unread (`{updated}`; the other tabs of the
 * person hear it), delete one and save the settings. Only the own inbox is reachable.
 */
#[IsDestructive]
#[IsReadOnly(false)]
#[IsOpenWorld(false)]
final class ManageNotificationsTool extends WriteTool
{
    protected string $name = 'manage-notifications';

    protected string $title = 'Manage notifications';

    protected string $description = 'Writes the own inbox. `read`: `input` {ids} or {all, mentions_only}; `unread`: `input` {ids}; both answer {updated}. '
        .'`save-preferences` changes the named cells.';

    protected function actions(): array
    {
        return [
            new McpAction(
                name: 'read',
                summary: 'Marks notifications read: by ids, or all unread ones.',
                run: fn (Actor $actor, McpArguments $args): McpResult => McpResult::body(['updated' => MarkNotificationsRead::run($actor, $args->input())]),
                input: OperationsSchemas::read(),
                required: ['input'],
                twin: 'POST notifications/read',
            ),
            new McpAction(
                name: 'unread',
                summary: 'Marks read notifications unread again.',
                run: fn (Actor $actor, McpArguments $args): McpResult => McpResult::body(['updated' => MarkNotificationsUnread::run($actor, $args->input())]),
                input: OperationsSchemas::unread(),
                required: ['input'],
                twin: 'POST notifications/unread',
            ),
            new McpAction(
                name: 'delete',
                summary: 'Deletes a notification of the own inbox.',
                run: function (Actor $actor, McpArguments $args): McpResult {
                    DeleteNotification::run($actor, References::ulid(Notification::class, $args->reference('notification')));

                    return McpResult::done();
                },
                parameters: ['notification' => ToolSchema::reference('notification')],
                required: ['notification'],
                twin: 'DELETE notifications/{notification}',
            ),
            new McpAction(
                name: 'save-preferences',
                summary: 'Changes the named cells of the settings; answers the whole matrix.',
                run: fn (Actor $actor, McpArguments $args): McpResult => McpResult::resource(NotificationPreferenceResource::collection(SaveNotificationPreferences::run($actor, $args->input()))),
                input: OperationsSchemas::preferences(),
                required: ['input'],
                twin: 'PUT notification-preferences',
            ),
        ];
    }
}
