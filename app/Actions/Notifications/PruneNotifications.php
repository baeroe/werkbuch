<?php

namespace App\Actions\Notifications;

use App\Models\Notification;
use App\Models\NotificationMail;
use App\Support\Actor;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Database\Eloquent\Model;
use Lorisleiva\Actions\Concerns\AsAction;

/**
 * Tidies up (A276), every hour from PruneNotificationsJob: read notifications whose `read_at` is older than KEEP_DAYS
 * (unread ones stay), rows only for mail (`inbox` off, A271) once their collection is closed (sent or skipped: both
 * set `sent_at`, K8), and closed collections older than KEEP_DAYS (their inbox rows stay, without `mail_id`). The
 * mail-only rows go before the collections, so none is left without its collection. In blocks of BLOCK, each its own
 * statement, so no run holds many rows at once. Work of a job without an event of its own.
 */
final class PruneNotifications
{
    use AsAction;

    /** The rows of one statement. */
    public const BLOCK = 1000;

    /** How long read notifications and sent collections stay. */
    public const KEEP_DAYS = 90;

    /**
     * @return int how many notifications and collections went
     */
    public function handle(Actor $actor): int
    {
        $before = now()->subDays(self::KEEP_DAYS);

        return self::inBlocks(Notification::query()->where('read_at', '<', $before))
            + self::inBlocks(Notification::query()->where('inbox', false)
                ->whereIn('mail_id', NotificationMail::query()->select('id')->whereNotNull('sent_at')))
            + self::inBlocks(NotificationMail::query()->where('sent_at', '<', $before));
    }

    /**
     * Deletes what the query finds, BLOCK rows at a time.
     *
     * @template TModel of Model
     *
     * @param  Builder<TModel>  $query
     */
    private static function inBlocks(Builder $query): int
    {
        $deleted = 0;
        do {
            $block = (clone $query)->orderBy('id')->limit(self::BLOCK)->delete();
            $deleted += $block;
        } while ($block === self::BLOCK);

        return $deleted;
    }
}
