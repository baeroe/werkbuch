<?php

namespace App\Console\Commands;

use App\Actions\Automations\RunDailyAutomations;
use App\Models\User;
use App\Support\Actor;
use Illuminate\Console\Command;

/**
 * The nightly automations in this process, for the current hour: they act only at 03:00 in the zone of the
 * organisation, with `--now` at any hour; `--project=<ULID>` acts in that project only (e2e, K9: the specs share the
 * database with the scheduler of DDEV).
 */
class RunAutomationsCommand extends Command
{
    protected $signature = 'app:run-automations
        {--now : Act at any hour, not only at 03:00 in the time zone of the organisation}
        {--project= : The ULID of the one project to act in}';

    protected $description = 'Run the nightly automations (Auto-Archiv, Auto-Close)';

    public function handle(): int
    {
        $project = $this->option('project');
        $counts = RunDailyAutomations::run(
            Actor::system(User::defaultBot(), 'daily_automations'),
            now()->utc()->startOfHour()->toImmutable(),
            (bool) $this->option('now'),
            is_string($project) ? $project : null,
        );
        $this->info("Archived {$counts['archived']}, closed {$counts['closed']}, skipped {$counts['skipped']}.");

        return self::SUCCESS;
    }
}
