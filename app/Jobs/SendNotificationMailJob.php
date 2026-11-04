<?php

namespace App\Jobs;

use App\Actions\Notifications\SendNotificationMail;
use App\Models\User;
use App\Support\Actor;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Foundation\Queue\Queueable;

/**
 * Sends a mail collection once it is due, on the queue `notifications` (NotifyRecipients puts it there after the commit,
 * delayed until `due_at`; DispatchDueMails again for a collection left behind). The action checks everything afresh and
 * sends a collection at most once, so a second job of the same collection does nothing. Every try stamps the
 * collection (`dispatched_at`), so the sweeper leaves it alone while the job still tries. When SMTP fails, the action
 * rolls back and the job tries again later.
 */
final class SendNotificationMailJob implements ShouldQueue
{
    use Queueable;

    public int $tries = 5;

    /** @var list<int> the last pause is shorter than DispatchDueMails::PAUSE_MINUTES (I1) */
    public array $backoff = [60, 300, 900, 1800];

    public function __construct(public string $mailId)
    {
        $this->onQueue('notifications');
    }

    public function handle(): void
    {
        SendNotificationMail::run(Actor::system(User::defaultBot(), 'notification_mail'), $this->mailId);
    }
}
