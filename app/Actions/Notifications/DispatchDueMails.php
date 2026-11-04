<?php

namespace App\Actions\Notifications;

use App\Jobs\SendNotificationMailJob;
use App\Models\NotificationMail;
use App\Support\Actor;
use Lorisleiva\Actions\Concerns\AsAction;

/**
 * The sweeper of the mail collections (`app:send-notification-mails`, every minute, A288): a collection that is due
 * for more than LATE_MINUTES and not sent lost its job (a crash between the commit and the dispatch, a job that ended in
 * failed_jobs), so it gets one again. Only when nothing tried it for PAUSE_MINUTES (`dispatched_at`, K8, I1): the
 * collection is stamped with its `due_at` when it opens and again by every try of its job, and the longest pause of the
 * job is shorter, so while SMTP is down the job that is there waits out its backoff alone instead of a new one each
 * quarter of an hour. The job checks everything afresh and
 * sends at most once, so one too many does no harm. With `$now` it sends every open collection at once, due or not, in
 * this process (operation before a maintenance, e2e). Work of a job without an event of its own.
 */
final class DispatchDueMails
{
    use AsAction;

    /** How long a collection may be due before the sweeper takes it. */
    public const LATE_MINUTES = 2;

    /** How long no try may have run before the sweeper dispatches the collection again (longer than the job's longest pause). */
    public const PAUSE_MINUTES = 35;

    /**
     * @return int how many collections it dispatched (or, with `$now`, sent or skipped)
     */
    public function handle(Actor $actor, bool $now = false): int
    {
        $mails = NotificationMail::query()->whereNull('sent_at')
            ->unless($now, fn ($query) => $query->where('due_at', '<', now()->subMinutes(self::LATE_MINUTES))
                ->where(fn ($paused) => $paused->whereNull('dispatched_at')->orWhere('dispatched_at', '<', now()->subMinutes(self::PAUSE_MINUTES))))
            ->orderBy('due_at')->orderBy('id')->pluck('id');

        if ($now) {
            $mails->each(fn (string $id) => SendNotificationMail::run($actor, $id));
        } else {
            NotificationMail::query()->whereKey($mails)->update(['dispatched_at' => now()]);
            $mails->each(fn (string $id) => SendNotificationMailJob::dispatch($id));
        }

        return $mails->count();
    }
}
