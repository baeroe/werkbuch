<?php

namespace App\Console\Commands;

use App\Actions\Templates\RunDueTemplates;
use App\Models\User;
use App\Support\Actor;
use Illuminate\Console\Command;

/**
 * Runs every minute (routes/console.php): puts a job on the queue for each template with a due term; with `--now` it
 * runs them in this process and fails when one of them failed (the others ran all the same); `--template` takes only
 * that one (e2e, K9: the DDEV scheduler works on the same database).
 */
class RunTemplatesCommand extends Command
{
    protected $signature = 'app:run-templates {--now : Run the due templates in this process} {--template= : Only this template (its ULID), if it is due}';

    protected $description = 'Queue (or run) the templates whose next term is due';

    public function handle(): int
    {
        $now = (bool) $this->option('now');
        $template = $this->option('template');
        $failed = 0;
        $count = RunDueTemplates::run(Actor::system(User::defaultBot(), 'templates'), $now, is_string($template) ? $template : null, function () use (&$failed): void {
            $failed++;
        });

        if ($failed > 0) {
            $this->error("Ran {$count} templates, {$failed} failed.");

            return self::FAILURE;
        }
        $this->info($now ? "Ran {$count} templates." : "Queued {$count} templates.");

        return self::SUCCESS;
    }
}
