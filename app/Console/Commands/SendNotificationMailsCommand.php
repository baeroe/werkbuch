<?php

namespace App\Console\Commands;

use App\Actions\Notifications\DispatchDueMails;
use App\Models\User;
use App\Support\Actor;
use Illuminate\Console\Command;

/**
 * Runs every minute (routes/console.php): puts the mail collections left behind on the queue again; with `--now` it
 * sends every open one at once (A288).
 */
class SendNotificationMailsCommand extends Command
{
    protected $signature = 'app:send-notification-mails {--now : Send every open collection now, due or not}';

    protected $description = 'Dispatch the notification mails left behind, or send every open one now';

    public function handle(): int
    {
        $now = (bool) $this->option('now');
        $count = DispatchDueMails::run(Actor::system(User::defaultBot(), 'notification_mail'), $now);

        $this->info($now ? "Sent or skipped {$count} open mail collections." : "Dispatched {$count} mail collections.");

        return self::SUCCESS;
    }
}
