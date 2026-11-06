<?php

namespace App\Actions\Webhooks;

use App\Access\Authorize;
use App\Models\Organization;
use App\Models\Webhook;
use App\Models\WebhookAttempt;
use App\Support\Actor;
use App\Support\ListResult;
use App\Support\PageArgs;
use Illuminate\Validation\ValidationException;
use Lorisleiva\Actions\Concerns\AsAction;

/**
 * The log of a webhook (spec 6.3): its attempts, the newest first, with the name of the event of their delivery. The
 * stamp is read raw as `attempted_cursor` (microseconds, like the history), then the ULID; only accounts with
 * `org.manage` read it. The delivery comes in one query for the whole page.
 */
final class ListWebhookDeliveries
{
    use AsAction;

    /**
     * @param  array<array-key, mixed>  $query  `cursor`, `per_page`
     * @return ListResult<WebhookAttempt>
     *
     * @throws ValidationException
     */
    public function handle(Actor $actor, Webhook $webhook, array $query): ListResult
    {
        Authorize::check($actor, 'manageWebhooks', Organization::class);

        return ListResult::of(
            WebhookAttempt::query()->with('delivery:id,event')
                // the stamp as the database has it: the cast would lose the microseconds in the cursor
                ->select('webhook_attempts.*')->addSelect('webhook_attempts.attempted_at as attempted_cursor')
                ->where('webhook_id', $webhook->id)
                ->orderByDesc('attempted_cursor')->orderByDesc('id'),
            PageArgs::from($query),
        );
    }
}
