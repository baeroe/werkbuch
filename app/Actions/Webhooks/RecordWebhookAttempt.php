<?php

namespace App\Actions\Webhooks;

use App\Domain\Webhooks\DisableRule;
use App\Models\Webhook;
use App\Models\WebhookAttempt;
use App\Models\WebhookDelivery;
use App\Support\Actor;
use App\Support\ResponseExcerpt;
use Illuminate\Support\Facades\DB;
use Lorisleiva\Actions\Concerns\AsAction;

/**
 * The log of one call of a receiver (spec 6.3, A366, A375, K2, K6), after the request and outside spatie's `try`: under
 * `lockForUpdate` of the webhook, then of the delivery, one `webhook_attempts` row (numbered on from the attempts of
 * the delivery; the answer cut to 2 KB, an error only without an answer, at most 300 characters).
 *
 * - The delivery: a success (2xx) of any kind finishes it as `succeeded`; a failed scheduled try makes it `failed`
 *   only at the last try and only from `pending` (never a cancelled or succeeded one, T8-M2); a failed "send again" or
 *   ping leaves it as it was (its scheduled tries go on, K6).
 * - The webhook: a success of any kind clears `failing_since` and sets `last_success_at`; a failed scheduled try of a
 *   delivery that is still `pending` under the lock sets `failing_since` if it is empty and switches the webhook off
 *   once it is 24 hours old (DisableRule, DisableWebhook). A failed ping or "send again", and a scheduled try of a
 *   delivery that is no longer pending, never count. Bookkeeping: no event, and the webhook keeps its `updated_at`.
 *
 * Work of a job without an event of its own; `null` for a delivery that is gone (its webhook deleted).
 */
final class RecordWebhookAttempt
{
    use AsAction;

    public const ERROR_MAX = 300;

    /**
     * @param  int|null  $status  the HTTP status of the answer, `null` without one
     * @param  string|null  $error  why there is no answer (`timeout: …`), ignored with one
     * @param  WebhookAttempt::SCHEDULED|WebhookAttempt::MANUAL|WebhookAttempt::PING  $kind
     * @param  bool  $final  whether it was the last try of the schedule
     */
    public function handle(Actor $actor, string $deliveryId, ?int $status, int $durationMs, ?string $body, ?string $error, string $kind, bool $final = false): ?WebhookAttempt
    {
        return DB::transaction(function () use ($actor, $deliveryId, $status, $durationMs, $body, $error, $kind, $final): ?WebhookAttempt {
            $webhookId = WebhookDelivery::query()->whereKey($deliveryId)->value('webhook_id');
            $webhook = is_string($webhookId) ? Webhook::query()->lockForUpdate()->find($webhookId) : null;
            $delivery = $webhook === null ? null : WebhookDelivery::query()->lockForUpdate()->find($deliveryId);
            if ($webhook === null || $delivery === null) {
                return null;
            }

            $now = now();
            $succeeded = $status !== null && $status >= 200 && $status < 300;
            // a scheduled try counts only while its delivery is open: one already under way when "send again" finished
            // the delivery (or switching off cancelled it) never fails it nor starts the clock (T8-M2)
            $scheduled = $kind === WebhookAttempt::SCHEDULED && $delivery->status === WebhookDelivery::PENDING;

            $attempt = WebhookAttempt::query()->create([
                'delivery_id' => $delivery->id,
                'webhook_id' => $webhook->id,
                'attempt' => $delivery->attempts + 1,
                'kind' => $kind,
                'status_code' => $status,
                'duration_ms' => max(0, $durationMs),
                'response_excerpt' => $status === null ? null : ResponseExcerpt::of($body),
                'error' => $status === null && $error !== null ? mb_substr($error, 0, self::ERROR_MAX) : null,
                'attempted_at' => $now,
            ]);

            $delivery->update([
                'attempts' => $delivery->attempts + 1,
                'status' => match (true) {
                    $succeeded => WebhookDelivery::SUCCEEDED,
                    $scheduled && $final => WebhookDelivery::FAILED,
                    default => $delivery->status,
                },
            ]);

            $webhook->timestamps = false;
            if ($succeeded) {
                $webhook->update(['failing_since' => null, 'last_success_at' => $now]);
            } elseif ($scheduled) {
                $webhook->update(['failing_since' => $webhook->failing_since ?? $now]);
                if (DisableRule::disables($webhook->failing_since, $now->toImmutable())) {
                    $webhook->timestamps = true;
                    DisableWebhook::run($actor, $webhook);
                }
            }

            return $attempt;
        }, 3);
    }
}
