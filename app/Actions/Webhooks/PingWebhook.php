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
use App\Webhooks\WebhookPayload;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use Lorisleiva\Actions\Concerns\AsAction;

/**
 * The test ping of a webhook (spec 6.3, A367, K6, K17): a delivery of the event `ping` without an event of the outbox,
 * its body made in a short transaction of its own, then, outside every transaction, one try in this request
 * (DeliverWebhook::sendNow, kind `ping`: about 10 s of HTTP plus the lookup of the name at the most). It goes to an
 * inactive webhook too and counts for nothing: a failed ping neither starts `failing_since` nor switches the webhook
 * off. It has no scheduled tries, so a failed one is `failed` at once. No event, bookkeeping like the log.
 */
final class PingWebhook
{
    use AsAction;

    /**
     * @return WebhookAttempt the attempt, with `delivery` loaded
     *
     * @throws Problem 403, 503 `webhook_not_logged` when the try left no log line
     */
    public function handle(Actor $actor, Webhook $webhook): WebhookAttempt
    {
        Authorize::check($actor, 'manageWebhooks', Organization::class);

        $delivery = DB::transaction(function () use ($actor, $webhook): WebhookDelivery {
            $delivery = new WebhookDelivery;
            $delivery->id = strtolower((string) Str::ulid());
            $delivery->fill([
                'webhook_id' => $webhook->id,
                'event_id' => null,
                'event' => 'ping',
                'body' => WebhookPayload::encode(WebhookPayload::ping($webhook, $actor->user, $delivery->id)),
                'status' => WebhookDelivery::PENDING,
                'attempts' => 0,
            ])->save();

            return $delivery;
        });

        $attempt = DeliverWebhook::sendNow($delivery, WebhookAttempt::PING);
        // a ping has no further tries: what did not succeed is over, also when the log lost its line
        WebhookDelivery::query()->whereKey($delivery->id)->where('status', WebhookDelivery::PENDING)
            ->update(['status' => WebhookDelivery::FAILED, 'updated_at' => now()]);
        if ($attempt === null) {
            throw Problem::unavailable('webhook_not_logged');
        }

        // fresh(): the row just created must not answer 201
        return $attempt->fresh('delivery') ?? throw Problem::notFound();
    }
}
