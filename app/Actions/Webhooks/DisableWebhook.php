<?php

namespace App\Actions\Webhooks;

use App\Events\EventRecorder;
use App\Events\EventType;
use App\Models\Webhook;
use App\Models\WebhookDelivery;
use App\Support\Actor;
use Illuminate\Support\Facades\DB;
use Lorisleiva\Actions\Concerns\AsAction;

/**
 * The system switches a webhook off that failed for 24 hours (A366): only one that is still on, so two tries that
 * fail at once switch it off once. `active` false, `disabled_at` now, every pending delivery cancelled (its waiting
 * tries find it so and send nothing), and the event `webhook.disabled` (no webhook itself) with `changes.active` and the name in `meta`, which
 * tells the org admins (NotificationFacts). The caller holds the webhook `for update` (RecordWebhookAttempt); its own transaction is a
 * savepoint there.
 */
final class DisableWebhook
{
    use AsAction;

    public function handle(Actor $actor, Webhook $locked): void
    {
        if (! $locked->active) {
            return;
        }

        DB::transaction(function () use ($actor, $locked): void {
            $locked->update(['active' => false, 'disabled_at' => now()]);
            WebhookDelivery::query()->where('webhook_id', $locked->id)->where('status', WebhookDelivery::PENDING)
                ->update(['status' => WebhookDelivery::CANCELLED, 'updated_at' => now()]);

            EventRecorder::record(EventType::WebhookDisabled, $actor, $locked, $locked->project, ['active' => ['old' => true, 'new' => false]], ['name' => $locked->name]);
        });
    }
}
