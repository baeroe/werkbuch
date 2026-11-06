<?php

namespace App\Http\Controllers\Api;

use App\Actions\Webhooks\DeleteWebhook;
use App\Actions\Webhooks\GetWebhook;
use App\Actions\Webhooks\ListWebhookDeliveries;
use App\Actions\Webhooks\ListWebhooks;
use App\Actions\Webhooks\PingWebhook;
use App\Actions\Webhooks\RedeliverWebhook;
use App\Actions\Webhooks\RotateWebhookSecret;
use App\Actions\Webhooks\SaveWebhook;
use App\Http\Api\Answer;
use App\Http\Api\ApiList;
use App\Http\Api\Body;
use App\Http\Api\ListOf;
use App\Http\Controllers\Controller;
use App\Http\Resources\WebhookDeliveryResource;
use App\Http\Resources\WebhookResource;
use App\Models\Webhook;
use App\Models\WebhookDelivery;
use App\OpenApi\OperationsSchemas;
use App\Support\Actor;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Http\Response;

/**
 * The webhooks (org admins and the default bot). `{webhook}` is bound by ULID only (any case); saving replaces a
 * webhook as a whole (`PUT`). The secret is next to `data` in the answers of creating and of `rotate-secret` only.
 */
final class WebhooksController extends Controller
{
    /**
     * List the webhooks.
     *
     * Organisation admins and the default bot only; never the secret.
     */
    #[ListOf(ListWebhooks::class)]
    public function index(Request $request): JsonResponse
    {
        return ApiList::respond(ListWebhooks::run(Actor::fromRequest($request), $request->query()), WebhookResource::class);
    }

    /**
     * Create a webhook.
     *
     * 201 `{data, secret}`. The secret is shown once, here and in `rotate-secret`; it is never read back.
     */
    #[Body(OperationsSchemas::class, 'webhook')]
    #[Answer(201, OperationsSchemas::class, 'withSecret', 'The new webhook and its secret, shown once.')]
    public function store(Request $request): JsonResponse
    {
        $saved = SaveWebhook::run(Actor::fromRequest($request), $request->all());

        return (new WebhookResource($saved['webhook']))->additional(['secret' => $saved['secret']])->response()->setStatusCode(201);
    }

    /**
     * Read a webhook.
     */
    public function show(Request $request, Webhook $webhook): WebhookResource
    {
        return new WebhookResource(GetWebhook::run(Actor::fromRequest($request), $webhook));
    }

    /**
     * Replace a webhook.
     *
     * The webhook as a whole; the secret stays.
     */
    #[Body(OperationsSchemas::class, 'webhook')]
    public function update(Request $request, Webhook $webhook): WebhookResource
    {
        return new WebhookResource(SaveWebhook::run(Actor::fromRequest($request), $request->all(), $webhook)['webhook']);
    }

    /**
     * Delete a webhook.
     *
     * 204. Its deliveries and attempts go with it.
     */
    public function destroy(Request $request, Webhook $webhook): Response
    {
        DeleteWebhook::run(Actor::fromRequest($request), $webhook);

        return response()->noContent();
    }

    /**
     * Renew the secret of a webhook.
     *
     * `{data, secret}`: the new secret is shown once; the old one stops working at once.
     */
    #[Answer(200, OperationsSchemas::class, 'withSecret', 'The webhook and its new secret, shown once.')]
    public function rotateSecret(Request $request, Webhook $webhook): WebhookResource
    {
        $rotated = RotateWebhookSecret::run(Actor::fromRequest($request), $webhook);

        return (new WebhookResource($rotated['webhook']))->additional(['secret' => $rotated['secret']]);
    }

    /**
     * Send a test ping.
     *
     * `{data: WebhookDelivery}`: the attempt of a test ping, sent in this request (up to about 10 seconds). Also to a switched-off webhook; a failed ping never counts towards switching it off. At most 6 a minute per account, shared with redelivering (429 `too_many_requests`); 503 `webhook_not_logged` when the attempt left no log line.
     */
    public function ping(Request $request, Webhook $webhook): WebhookDeliveryResource
    {
        return new WebhookDeliveryResource(PingWebhook::run(Actor::fromRequest($request), $webhook));
    }

    /**
     * List the attempts of a webhook.
     *
     * The attempts of the webhook, the newest first.
     */
    #[ListOf(ListWebhookDeliveries::class)]
    public function deliveries(Request $request, Webhook $webhook): JsonResponse
    {
        return ApiList::respond(ListWebhookDeliveries::run(Actor::fromRequest($request), $webhook, $request->query()), WebhookDeliveryResource::class);
    }

    /**
     * Send a delivery again.
     *
     * `{data: WebhookDelivery}`: the attempt of sending a delivery again, made in this request with the same body and delivery ID but a new timestamp. At most 6 a minute per account, shared with the test ping (429 `too_many_requests`); 404 for a delivery of another webhook.
     */
    public function redeliver(Request $request, Webhook $webhook, WebhookDelivery $delivery): WebhookDeliveryResource
    {
        return new WebhookDeliveryResource(RedeliverWebhook::run(Actor::fromRequest($request), $webhook, $delivery));
    }
}
