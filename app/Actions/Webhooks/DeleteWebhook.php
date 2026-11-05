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
 * Deletes a webhook (accounts with `org.manage`); its deliveries and attempts go by cascade, a job still waiting for
 * one finds nothing. The row is read afresh under `lockForUpdate`: a change at the same time waits, a second deletion
 * finds it gone (404, no second event). The event names the webhook in `meta.name`, the subject is gone afterwards.
 */
final class DeleteWebhook
{
    use AsAction;

    /**
     * @throws Problem 403, or 404 for a webhook deleted meanwhile
     */
    public function handle(Actor $actor, Webhook $webhook): void
    {
        Authorize::check($actor, 'manageWebhooks', Organization::class);

        DB::transaction(function () use ($actor, $webhook): void {
            $current = Webhook::query()->lockForUpdate()->find($webhook->id) ?? throw Problem::notFound();

            EventRecorder::record(EventType::WebhookDeleted, $actor, $current, $current->project, meta: ['name' => $current->name]);
            $current->delete();
        });
    }
}
