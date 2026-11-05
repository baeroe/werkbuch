<?php

namespace App\Actions\Templates;

use App\Models\Template;
use App\Support\Actor;
use App\Support\TemplateSchedule;
use DateTimeZone;
use Lorisleiva\Actions\Concerns\AsAction;

/**
 * Every schedule counts anew from now (A339): `schedule_from` now and `next_run_at` worked out on the calendar of the
 * zone, for each template with a schedule (a paused one included) — of the organisation when its time zone changes
 * (UpdateOrganization, in its transaction after the zone is written; the zone is handed in, K3) or of one project when
 * it is restored (ArchiveProject). No term from before this moment runs, neither of the old calendar nor of the
 * archive. Without an event of its own (K23: `organization.updated` and `project.restored` carry the change) and without
 * touching `updated_at` (the mark of a template's version, K16).
 */
final class RescheduleTemplates
{
    use AsAction;

    /** How many templates it rescheduled. */
    public function handle(Actor $actor, string $zone, ?string $projectId = null): int
    {
        $now = now()->toImmutable();
        $timezone = new DateTimeZone($zone);
        $count = 0;

        Template::query()->whereNotNull('schedule')
            ->when($projectId !== null, fn ($query) => $query->where('project_id', $projectId))
            ->lockForUpdate()->orderBy('id')
            ->each(function (Template $template) use ($now, $timezone, &$count): void {
                $template->timestamps = false;
                $template->forceFill([
                    'schedule_from' => $now,
                    'next_run_at' => TemplateSchedule::nextRunAt($template->schedule(), $now, $template->run_count, $now, $timezone),
                ])->save();
                $count++;
            });

        return $count;
    }
}
