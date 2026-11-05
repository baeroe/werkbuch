<?php

namespace App\Actions\Templates;

use App\Jobs\RunTemplateJob;
use App\Models\Template;
use App\Support\Actor;
use Lorisleiva\Actions\Concerns\AsAction;

/**
 * The sweeper of the schedules (`app:run-templates`, every minute): the templates whose `next_run_at` is due, not
 * paused, in a project neither archived nor being deleted, at most BATCH per run, the longest due first. Each gets a
 * RunTemplateJob on `default` (unique per template, K15: a job still waiting is not queued again) or, inline (`--now`),
 * its run in this process (RunScheduledTemplate). Either way the run works the term out afresh, so a template taken
 * twice runs its term once. One query for the list, whatever the number of templates.
 */
final class RunDueTemplates
{
    use AsAction;

    /** The most templates one run of the sweeper takes (like DispatchDueMails). */
    public const BATCH = 500;

    /** How many templates it took. */
    public function handle(Actor $actor, bool $inline = false): int
    {
        $ids = Template::query()
            ->join('projects', 'projects.id', '=', 'templates.project_id')
            ->whereNotNull('templates.next_run_at')
            ->where('templates.next_run_at', '<=', now())
            ->where('templates.schedule->paused', false)
            ->whereNull('projects.archived_at')
            ->whereNull('projects.deleting_at')
            ->orderBy('templates.next_run_at')->orderBy('templates.id')
            ->limit(self::BATCH)
            ->pluck('templates.id');

        foreach ($ids as $id) {
            $inline ? RunScheduledTemplate::run($actor, $id) : RunTemplateJob::dispatch($id);
        }

        return $ids->count();
    }
}
