<?php

namespace App\Mcp\Tools;

use App\Actions\Webhooks\DeleteWebhook;
use App\Actions\Webhooks\PingWebhook;
use App\Actions\Webhooks\RedeliverWebhook;
use App\Actions\Webhooks\RotateWebhookSecret;
use App\Actions\Webhooks\SaveWebhook;
use App\Http\Resources\WebhookDeliveryResource;
use App\Http\Resources\WebhookResource;
use App\Mcp\Support\McpAction;
use App\Mcp\Support\McpArguments;
use App\Mcp\Support\McpResult;
use App\Mcp\Support\RouteThrottle;
use App\Mcp\Support\ToolSchema;
use App\Mcp\Support\WriteTool;
use App\Models\WebhookDelivery;
use App\OpenApi\OperationsSchemas;
use App\Support\Actor;
use App\Support\References;
use Laravel\Mcp\Server\Tools\Annotations\IsDestructive;
use Laravel\Mcp\Server\Tools\Annotations\IsReadOnly;

/**
 * `manage-webhooks` (spec 6.2), the pair of `webhooks`. It is the one tool in the open world (K17): `ping` and
 * `redeliver` call the receiver. Both count in the quota `webhook-send` of REST (six a minute per account, K16). The
 * secret is in the answers of `create` and `rotate-secret` only.
 */
#[IsDestructive]
#[IsReadOnly(false)]
final class ManageWebhooksTool extends WriteTool
{
    protected string $name = 'manage-webhooks';

    protected string $title = 'Manage webhooks';

    protected string $description = 'Writes webhooks (org admins). `create` and `rotate-secret` answer {data, secret}: the secret is shown once and ends up in the history of the agent. '
        .'`update` replaces the webhook as a whole. `ping` and `redeliver` call the receiver; 6 a minute together.';

    protected function actions(): array
    {
        $webhook = ['webhook' => ToolSchema::reference('webhook')];

        return [
            new McpAction(
                name: 'create',
                summary: 'Creates a webhook; answers {data, secret}.',
                run: function (Actor $actor, McpArguments $args): McpResult {
                    $saved = SaveWebhook::run($actor, $args->input());

                    return McpResult::resource((new WebhookResource($saved['webhook']))->additional(['secret' => $saved['secret']]));
                },
                input: OperationsSchemas::webhook(),
                required: ['input'],
                twin: 'POST webhooks',
            ),
            new McpAction(
                name: 'update',
                summary: 'Replaces a webhook as a whole; no secret in the answer.',
                run: fn (Actor $actor, McpArguments $args): McpResult => McpResult::resource(new WebhookResource(SaveWebhook::run($actor, $args->input(), WebhooksTool::webhook($args))['webhook'])),
                parameters: $webhook,
                input: OperationsSchemas::webhook(),
                required: ['webhook', 'input'],
                twin: 'PUT webhooks/{webhook}',
            ),
            new McpAction(
                name: 'delete',
                summary: 'Deletes a webhook with its attempts.',
                run: function (Actor $actor, McpArguments $args): McpResult {
                    DeleteWebhook::run($actor, WebhooksTool::webhook($args));

                    return McpResult::done();
                },
                parameters: $webhook,
                required: ['webhook'],
                twin: 'DELETE webhooks/{webhook}',
            ),
            new McpAction(
                name: 'rotate-secret',
                summary: 'A new secret; the old one stops working. Answers {data, secret}.',
                run: function (Actor $actor, McpArguments $args): McpResult {
                    $rotated = RotateWebhookSecret::run($actor, WebhooksTool::webhook($args));

                    return McpResult::resource((new WebhookResource($rotated['webhook']))->additional(['secret' => $rotated['secret']]));
                },
                parameters: $webhook,
                required: ['webhook'],
                twin: 'POST webhooks/{webhook}/rotate-secret',
            ),
            new McpAction(
                name: 'ping',
                summary: 'Sends a test ping now and answers its attempt.',
                run: function (Actor $actor, McpArguments $args): McpResult {
                    RouteThrottle::hit('webhook-send', request());

                    return McpResult::resource(new WebhookDeliveryResource(PingWebhook::run($actor, WebhooksTool::webhook($args))));
                },
                parameters: $webhook,
                required: ['webhook'],
                twin: 'POST webhooks/{webhook}/ping',
            ),
            new McpAction(
                name: 'redeliver',
                summary: 'Sends a delivery again and answers the new attempt.',
                run: function (Actor $actor, McpArguments $args): McpResult {
                    RouteThrottle::hit('webhook-send', request());

                    return McpResult::resource(new WebhookDeliveryResource(RedeliverWebhook::run(
                        $actor,
                        WebhooksTool::webhook($args),
                        References::ulid(WebhookDelivery::class, $args->reference('delivery')),
                    )));
                },
                parameters: [...$webhook, 'delivery' => ToolSchema::reference('delivery')],
                required: ['webhook', 'delivery'],
                twin: 'POST webhooks/{webhook}/deliveries/{delivery}/redeliver',
            ),
        ];
    }
}
