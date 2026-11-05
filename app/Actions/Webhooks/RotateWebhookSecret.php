<?php

namespace App\Actions\Webhooks;

use App\Access\Authorize;
use App\Events\EventRecorder;
use App\Events\EventType;
use App\Exceptions\Problem;
use App\Models\Organization;
use App\Models\Webhook;
use App\Support\Actor;
use Illuminate\Support\Facades\DB;
use Lorisleiva\Actions\Concerns\AsAction;

/**
 * Makes a new secret for a webhook (A369): valid at once, also for retries still waiting (every attempt reads it
 * afresh), the old one stops. The secret is in the answer of this call only; the event has no changes.
 */
final class RotateWebhookSecret
{
    use AsAction;

    /**
     * @return array{webhook: Webhook, secret: string}
     *
     * @throws Problem 403, or 404 for a webhook deleted meanwhile
     */
    public function handle(Actor $actor, Webhook $webhook): array
    {
        Authorize::check($actor, 'manageWebhooks', Organization::class);

        return DB::transaction(function () use ($actor, $webhook): array {
            $current = Webhook::query()->lockForUpdate()->find($webhook->id) ?? throw Problem::notFound();

            $secret = Webhook::newSecret();
            $current->update(['secret' => $secret]);
            EventRecorder::record(EventType::WebhookSecretRotated, $actor, $current, $current->project);

            return ['webhook' => $current, 'secret' => $secret];
        });
    }
}
