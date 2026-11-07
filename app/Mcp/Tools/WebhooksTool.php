<?php

namespace App\Mcp\Tools;

use App\Actions\Webhooks\GetWebhook;
use App\Actions\Webhooks\ListWebhookDeliveries;
use App\Actions\Webhooks\ListWebhooks;
use App\Http\Resources\WebhookDeliveryResource;
use App\Http\Resources\WebhookResource;
use App\Mcp\Support\McpAction;
use App\Mcp\Support\McpArguments;
use App\Mcp\Support\McpResult;
use App\Mcp\Support\ReadTool;
use App\Mcp\Support\ToolSchema;
use App\Models\Webhook;
use App\Support\Actor;
use App\Support\References;
use Laravel\Mcp\Server\Tools\Annotations\IsOpenWorld;
use Laravel\Mcp\Server\Tools\Annotations\IsReadOnly;

/**
 * `webhooks` (spec 6.2): org admins and the default bot read the webhooks and their attempts. Never the secret.
 */
#[IsReadOnly]
#[IsOpenWorld(false)]
final class WebhooksTool extends ReadTool
{
    protected string $name = 'webhooks';

    protected string $title = 'Webhooks';

    protected string $description = 'Reads webhooks: the list, one webhook and its attempts (newest first). Org admins only; the secret is never shown.';

    protected function actions(): array
    {
        $list = ToolSchema::list(ListWebhooks::spec());
        $deliveries = ToolSchema::list(ListWebhookDeliveries::spec());
        $webhook = ['webhook' => ToolSchema::reference('webhook')];

        return [
            new McpAction(
                name: 'list',
                summary: 'A page of the webhooks.',
                run: fn (Actor $actor, McpArguments $args): McpResult => McpResult::list(ListWebhooks::run($actor, $args->query(array_keys($list))), WebhookResource::class),
                parameters: $list,
                twin: 'GET webhooks',
            ),
            new McpAction(
                name: 'get',
                summary: 'One webhook.',
                run: fn (Actor $actor, McpArguments $args): McpResult => McpResult::resource(new WebhookResource(GetWebhook::run($actor, self::webhook($args)))),
                parameters: $webhook,
                required: ['webhook'],
                twin: 'GET webhooks/{webhook}',
            ),
            new McpAction(
                name: 'deliveries',
                summary: 'The attempts of a webhook, newest first.',
                run: fn (Actor $actor, McpArguments $args): McpResult => McpResult::list(ListWebhookDeliveries::run($actor, self::webhook($args), $args->query(array_keys($deliveries))), WebhookDeliveryResource::class),
                parameters: [...$webhook, ...$deliveries],
                required: ['webhook'],
                twin: 'GET webhooks/{webhook}/deliveries',
            ),
        ];
    }

    public static function webhook(McpArguments $args): Webhook
    {
        return References::ulid(Webhook::class, $args->reference('webhook'));
    }
}
