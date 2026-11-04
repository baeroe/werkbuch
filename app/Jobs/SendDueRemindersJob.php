<?php

namespace App\Jobs;

use App\Actions\Notifications\SendDueReminders;
use App\Models\User;
use App\Support\Actor;
use Carbon\CarbonImmutable;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Foundation\Queue\Queueable;

/**
 * Reminds of what is due (spec 4.14, A275), on the queue `notifications`, for the hour the scheduler planned it in
 * (routes/console.php, K10): a job that waits on the queue past the hour still reminds the zones of its hour and no
 * other. Two runs of the same hour do no harm (SendDueReminders writes each reminder once), so there is no lock of its
 * own: a lock would drop the job of the next hour while one of an earlier hour is still running.
 */
final class SendDueRemindersJob implements ShouldQueue
{
    use Queueable;

    public function __construct(public CarbonImmutable $hourUtc)
    {
        $this->onQueue('notifications');
    }

    public function handle(): void
    {
        SendDueReminders::run(Actor::system(User::defaultBot(), 'due_reminders'), $this->hourUtc);
    }
}
