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
use App\Http\Api\ApiList;
use App\Http\Controllers\Controller;
use App\Http\Resources\WebhookDeliveryResource;
use App\Http\Resources\WebhookResource;
use App\Models\Webhook;
use App\Models\WebhookDelivery;
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
    public function index(Request $request): JsonResponse
    {
        return ApiList::respond(ListWebhooks::run(Actor::fromRequest($request), $request->query()), WebhookResource::class);
    }

    /** 201 `{data, secret}`: the new webhook was just created. */
    public function store(Request $request): WebhookResource
    {
        $saved = SaveWebhook::run(Actor::fromRequest($request), $request->all());

        return (new WebhookResource($saved['webhook']))->additional(['secret' => $saved['secret']]);
    }

    public function show(Request $request, Webhook $webhook): WebhookResource
    {
        return new WebhookResource(GetWebhook::run(Actor::fromRequest($request), $webhook));
    }

    public function update(Request $request, Webhook $webhook): WebhookResource
    {
        return new WebhookResource(SaveWebhook::run(Actor::fromRequest($request), $request->all(), $webhook)['webhook']);
    }

    /** 204. */
    public function destroy(Request $request, Webhook $webhook): Response
    {
        DeleteWebhook::run(Actor::fromRequest($request), $webhook);

        return response()->noContent();
    }

    /** `{data, secret}`. */
    public function rotateSecret(Request $request, Webhook $webhook): WebhookResource
    {
        $rotated = RotateWebhookSecret::run(Actor::fromRequest($request), $webhook);

        return (new WebhookResource($rotated['webhook']))->additional(['secret' => $rotated['secret']]);
    }

    /** `{data: WebhookDelivery}`: the attempt of a test ping, sent in this request. */
    public function ping(Request $request, Webhook $webhook): WebhookDeliveryResource
    {
        return new WebhookDeliveryResource(PingWebhook::run(Actor::fromRequest($request), $webhook));
    }

    /** `{data: WebhookDelivery[], links, meta}`: the attempts of the webhook, the newest first. */
    public function deliveries(Request $request, Webhook $webhook): JsonResponse
    {
        return ApiList::respond(ListWebhookDeliveries::run(Actor::fromRequest($request), $webhook, $request->query()), WebhookDeliveryResource::class);
    }

    /** `{data: WebhookDelivery}`: the attempt of sending a delivery again, made in this request. */
    public function redeliver(Request $request, Webhook $webhook, WebhookDelivery $delivery): WebhookDeliveryResource
    {
        return new WebhookDeliveryResource(RedeliverWebhook::run(Actor::fromRequest($request), $webhook, $delivery));
    }
}
