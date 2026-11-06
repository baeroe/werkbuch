<?php

namespace App\Actions\Webhooks;

use App\Access\Authorize;
use App\Models\Organization;
use App\Models\Webhook;
use App\Models\WebhookAttempt;
use App\Support\Actor;
use App\Support\ListFilter;
use App\Support\ListQuery;
use App\Support\ListResult;
use App\Support\ListSpec;
use App\Support\PageArgs;
use Illuminate\Database\Eloquent\Builder;
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

    /** The rules of the list (A386, K11): the rows are attempts; `event` is the one of their delivery, `succeeded` an answer of 2xx. */
    public static function spec(): ListSpec
    {
        return new ListSpec(
            filters: [
                ListFilter::scope('event', 'string', fn (Builder $query, mixed $event) => $query->whereHas('delivery', fn (Builder $delivery) => $delivery->where('event', $event))),
                ListFilter::exact('kind', 'webhook_attempts.kind', WebhookAttempt::KINDS),
                ListFilter::scope('succeeded', 'boolean', fn (Builder $query, mixed $succeeded) => $succeeded
                    ? $query->whereBetween('webhook_attempts.status_code', [200, 299])
                    : $query->where(fn (Builder $failed) => $failed->whereNull('webhook_attempts.status_code')->orWhereNotBetween('webhook_attempts.status_code', [200, 299]))),
            ],
            // the stamp as the database has it, with its microseconds, as the alias `attempted_cursor`
            sorts: ['attempted_at' => 'attempted_cursor'],
            default: ['-attempted_at'],
        );
    }

    /**
     * @param  array<array-key, mixed>  $query  `filter`, `sort`, `cursor`, `per_page`
     * @return ListResult<WebhookAttempt>
     *
     * @throws ValidationException
     */
    public function handle(Actor $actor, Webhook $webhook, array $query): ListResult
    {
        Authorize::check($actor, 'manageWebhooks', Organization::class);

        [$attempts, $signature] = ListQuery::apply(
            WebhookAttempt::query()->with('delivery:id,event')
                // the stamp as the database has it: the cast would lose the microseconds in the cursor
                ->select('webhook_attempts.*')->addSelect('webhook_attempts.attempted_at as attempted_cursor')
                ->where('webhook_id', $webhook->id),
            $query,
            self::spec(),
        );

        return ListResult::of($attempts, PageArgs::from($query), $signature);
    }
}
