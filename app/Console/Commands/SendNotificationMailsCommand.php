<?php

namespace App\Console\Commands;

use App\Actions\Notifications\DispatchDueMails;
use App\Models\User;
use App\Support\Actor;
use Illuminate\Console\Command;

/**
 * Runs every minute (routes/console.php): puts the mail collections left behind on the queue again; with `--now` it
 * sends every open one at once (A288) and fails when one of them failed (the others went all the same).
 */
class SendNotificationMailsCommand extends Command
{
    protected $signature = 'app:send-notification-mails {--now : Send every open collection now, due or not}';

    protected $description = 'Dispatch the notification mails left behind, or send every open one now';

    public function handle(): int
    {
        $now = (bool) $this->option('now');
        ['taken' => $count, 'failed' => $failed] = DispatchDueMails::run(Actor::system(User::defaultBot(), 'notification_mail'), $now);

        if ($failed > 0) {
            $this->error("Sent or skipped {$count} open mail collections, {$failed} failed.");

            return self::FAILURE;
        }
        $this->info($now ? "Sent or skipped {$count} open mail collections." : "Dispatched {$count} mail collections.");

        return self::SUCCESS;
    }
}
