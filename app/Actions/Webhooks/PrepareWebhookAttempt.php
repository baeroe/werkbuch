<?php

namespace App\Actions\Webhooks;

use App\Access\Visibility;
use App\Models\Event;
use App\Models\Project;
use App\Models\Webhook;
use App\Models\WebhookAttempt;
use App\Models\WebhookDelivery;
use App\Support\Actor;
use App\Webhooks\SafeTarget;
use App\Webhooks\Target;
use App\Webhooks\UnsafeTarget;
use Lorisleiva\Actions\Concerns\AsAction;

/**
 * What one attempt of a delivery may do, read afresh before it sends (spec 6.3, Review Focus 3, K6, T6-M4): the
 * delivery and its webhook, the URL, the secret and the body from their rows, then the target checked after DNS.
 *
 * | | scheduled | manual ("send again") | ping |
 * |---|---|---|---|
 * | delivery or webhook gone | nothing | nothing | nothing |
 * | delivery not pending | nothing | goes | goes |
 * | webhook off (`active` false or `disabled_at`) | cancelled | goes | goes |
 * | bot inactive or without the project of the event | cancelled | refused (`bot_access`, no HTTP) | goes |
 *
 * A refused target comes back as the UnsafeTarget the job throws, so the try is logged as a failure without a request.
 * Reads outside any transaction (the lookup may wait); work of a job without an event of its own.
 */
final class PrepareWebhookAttempt
{
    use AsAction;

    /**
     * @param  WebhookAttempt::SCHEDULED|WebhookAttempt::MANUAL|WebhookAttempt::PING  $kind
     * @return array{target: Target|UnsafeTarget, secret: string, url: string, body: string, event: string}|null
     */
    public function handle(Actor $actor, string $deliveryId, string $kind): ?array
    {
        $delivery = WebhookDelivery::query()->find($deliveryId);
        $webhook = $delivery === null ? null : Webhook::query()->with('bot')->find($delivery->webhook_id);
        if ($delivery === null || $webhook === null) {
            return null;
        }

        $scheduled = $kind === WebhookAttempt::SCHEDULED;
        if ($scheduled && $delivery->status !== WebhookDelivery::PENDING) {
            return null;
        }
        if ($scheduled && (! $webhook->active || $webhook->disabled_at !== null)) {
            return $this->cancel($delivery);
        }

        $refused = null;
        if ($kind !== WebhookAttempt::PING && ! $this->botSees($webhook, $delivery)) {
            if ($scheduled) {
                return $this->cancel($delivery);
            }
            $refused = new UnsafeTarget(UnsafeTarget::BOT_ACCESS);
        }

        try {
            $target = $refused ?? SafeTarget::check($webhook->url);
        } catch (UnsafeTarget $unsafe) {
            $target = $unsafe;
        }

        return ['target' => $target, 'secret' => $webhook->secret, 'url' => $webhook->url, 'body' => $delivery->body, 'event' => $delivery->event];
    }

    /**
     * Whether the bot of the webhook still sees the project of the event (a webhook without a bot: yes): active, and
     * member of it or it is public, never a project being deleted. A delivery without an event it can read sees nothing.
     */
    private function botSees(Webhook $webhook, WebhookDelivery $delivery): bool
    {
        if ($webhook->bot === null) {
            return true;
        }

        $projectId = $delivery->event_id === null ? null : Event::query()->whereKey($delivery->event_id)->value('project_id');
        $project = is_string($projectId) ? Project::query()->find($projectId) : null;
        Visibility::forget();

        return $project !== null && Visibility::roleIn($webhook->bot, $project) !== null;
    }

    /** Stops a scheduled delivery that may no longer go out; one that finished meanwhile stays as it is. */
    private function cancel(WebhookDelivery $delivery): null
    {
        WebhookDelivery::query()->whereKey($delivery->id)->where('status', WebhookDelivery::PENDING)
            ->update(['status' => WebhookDelivery::CANCELLED, 'updated_at' => now()]);

        return null;
    }
}
