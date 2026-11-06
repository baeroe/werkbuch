<?php

namespace App\Actions\Webhooks;

use App\Models\WebhookDelivery;
use App\Support\Actor;
use App\Support\QueuedJobs;
use Illuminate\Support\Facades\DB;
use Lorisleiva\Actions\Concerns\AsAction;

/**
 * Tidies up the log of the deliveries, every hour from PruneWebhookDeliveriesJob (task 10, K15): first a delivery that
 * waits and was last active (`updated_at`: created, or its last attempt) longer ago than the longest pause of the
 * back-off and a day more (its job got lost, a log row was dropped) becomes `failed`, without an event and without
 * switching the webhook off; never while the queue `webhooks` holds a job that is due, for after a worker was down the
 * jobs of `default` (this one) run first and the waiting tries still come (T10-M2); then
 * every delivery that is not waiting and has not changed for KEEP_DAYS goes with its attempts (cascade), BLOCK rows at
 * a time. Work of a job without an event of its own.
 */
final class PruneWebhookDeliveries
{
    use AsAction;

    /** The rows of one statement. */
    public const BLOCK = 500;

    /** How long a finished delivery stays after its last change. */
    public const KEEP_DAYS = 30;

    /** The longest pause of the back-off (12 hours) and a day more since the last activity of a lost delivery. */
    public const LOST_AFTER_SECONDS = 43200 + 86400;

    /**
     * @return int how many deliveries went
     */
    public function handle(Actor $actor): int
    {
        if (! QueuedJobs::backlog((string) config('webhook-server.queue'))) {
            WebhookDelivery::query()->where('status', WebhookDelivery::PENDING)
                ->where('updated_at', '<', now()->subSeconds(self::LOST_AFTER_SECONDS))
                ->toBase()->update(['status' => WebhookDelivery::FAILED, 'updated_at' => now()]);
        }

        $query = WebhookDelivery::query()->where('status', '!=', WebhookDelivery::PENDING)
            ->where('updated_at', '<=', now()->subDays(self::KEEP_DAYS));

        $deleted = 0;
        do {
            $block = DB::table('webhook_deliveries')->whereIn('id', (clone $query)->orderBy('updated_at')->limit(self::BLOCK)->pluck('id'))->delete();
            $deleted += $block;
        } while ($block === self::BLOCK);

        return $deleted;
    }
}
