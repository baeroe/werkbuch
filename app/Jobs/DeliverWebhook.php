<?php

namespace App\Jobs;

use App\Models\WebhookDelivery;
use Spatie\WebhookServer\CallWebhookJob;
use Spatie\WebhookServer\WebhookCall;

/**
 * One delivery of a webhook (spec 6.3) as the job of spatie/laravel-webhook-server: queue `webhooks`, the tries and
 * the pauses of Backoff (A365), the timeout and the rest from config/webhook-server.php (K1). The job carries no body
 * and no secret (K7, spec 7.5): each try reads both afresh from the rows. Sending, signing and the log come with task
 * 7; until then a try sends nothing and the delivery stays pending.
 */
final class DeliverWebhook extends CallWebhookJob
{
    /**
     * Queues the first try of the delivery after the commit of the transaction that wrote it. Not named `queue`: the
     * bus calls a method of that name on a job to push it itself.
     */
    public static function enqueue(WebhookDelivery $delivery): void
    {
        // create() reads config/webhook-server.php; a useJob() after it would throw those settings away (K1)
        WebhookCall::create()
            ->url($delivery->webhook->url)
            ->sendRawBody('')
            ->uuid($delivery->id)
            ->meta(['delivery_id' => $delivery->id, 'kind' => 'scheduled'])
            ->doNotSign()
            ->dispatch()
            ->afterCommit();
    }

    /** Task 7 sends; until then nothing leaves. */
    public function handle(): void {}
}
