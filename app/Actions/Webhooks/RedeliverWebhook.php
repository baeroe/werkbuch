<?php

namespace App\Actions\Webhooks;

use App\Access\Authorize;
use App\Exceptions\Problem;
use App\Jobs\DeliverWebhook;
use App\Models\Organization;
use App\Models\Webhook;
use App\Models\WebhookAttempt;
use App\Models\WebhookDelivery;
use App\Support\Actor;
use Lorisleiva\Actions\Concerns\AsAction;

/**
 * "Send again" (spec 6.3, A367, K6, K17): one more try of a delivery in this request, outside every transaction, with
 * the same body and the same `X-Werkbuch-Delivery`, a new timestamp and the next number on the log. It goes to a webhook
 * that is off too, but not past a bot that lost the project (PrepareWebhookAttempt). A success finishes the delivery
 * as `succeeded`; a failure leaves its status, so the scheduled tries that are still to come go on. It never counts
 * towards switching the webhook off. No event.
 */
final class RedeliverWebhook
{
    use AsAction;

    /**
     * @return WebhookAttempt the attempt, with `delivery` loaded
     *
     * @throws Problem 403, and 404 for a delivery of another webhook
     */
    public function handle(Actor $actor, Webhook $webhook, WebhookDelivery $delivery): WebhookAttempt
    {
        Authorize::check($actor, 'manageWebhooks', Organization::class);
        if ($delivery->webhook_id !== $webhook->id) {
            throw Problem::notFound();
        }

        $before = (int) (WebhookDelivery::query()->whereKey($delivery->id)->value('attempts') ?? throw Problem::notFound());
        DeliverWebhook::sendNow($delivery, WebhookAttempt::MANUAL);

        return WebhookAttempt::query()->where('delivery_id', $delivery->id)->where('attempt', '>', $before)
            ->with('delivery')->orderBy('attempt')->first() ?? throw Problem::notFound();
    }
}
