<?php

namespace App\Console\Commands;

use App\Actions\Templates\RunDueTemplates;
use App\Models\User;
use App\Support\Actor;
use Illuminate\Console\Command;

/**
 * Runs every minute (routes/console.php): puts a job on the queue for each template with a due term; with `--now` it
 * runs them in this process (e2e).
 */
class RunTemplatesCommand extends Command
{
    protected $signature = 'app:run-templates {--now : Run the due templates in this process}';

    protected $description = 'Queue (or run) the templates whose next term is due';

    public function handle(): int
    {
        $now = (bool) $this->option('now');
        $count = RunDueTemplates::run(Actor::system(User::defaultBot(), 'templates'), $now);
        $this->info($now ? "Ran {$count} templates." : "Queued {$count} templates.");

        return self::SUCCESS;
    }
}
