<?php

namespace App\Actions\Webhooks;

use App\Domain\Webhooks\Backoff;
use App\Models\WebhookDelivery;
use App\Support\Actor;
use Illuminate\Support\Facades\DB;
use Lorisleiva\Actions\Concerns\AsAction;

/**
 * Tidies up the log of the deliveries, every hour from PruneWebhookDeliveriesJob (task 10, K15): first a delivery that
 * waits since longer than its last try could be (the last offset of the back-off and a day more: its job got lost, a
 * worker died, a log row was dropped) becomes `failed`, without an event and without switching the webhook off; then
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

    /** A day on top of the last try of the back-off before a waiting delivery counts as lost. */
    public const LOST_AFTER_SECONDS = Backoff::OFFSETS[7] + 86400;

    /**
     * @return int how many deliveries went
     */
    public function handle(Actor $actor): int
    {
        WebhookDelivery::query()->where('status', WebhookDelivery::PENDING)
            ->where('created_at', '<', now()->subSeconds(self::LOST_AFTER_SECONDS))
            ->toBase()->update(['status' => WebhookDelivery::FAILED, 'updated_at' => now()]);

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
