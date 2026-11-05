<?php

namespace App\Actions\Projects;

use App\Access\Authorize;
use App\Access\Visibility;
use App\Actions\Templates\RescheduleTemplates;
use App\Events\EventRecorder;
use App\Events\EventType;
use App\Models\Project;
use App\Support\Actor;
use App\Support\CatalogLock;
use Illuminate\Support\Facades\DB;
use Lorisleiva\Actions\Concerns\AsAction;

/**
 * Archives a project (its admins): it becomes read-only and leaves navigation and views; `false` restores it (spec 4.4).
 * Restoring is its own event, `project.restored` (P11), and makes the schedules of its templates count anew from now
 * (RescheduleTemplates: no term of the archive is caught up, A339). Archiving an archived project keeps its time and
 * records nothing.
 */
final class ArchiveProject
{
    use AsAction;

    public function handle(Actor $actor, Project $project, bool $archived = true): Project
    {
        Authorize::check($actor, 'archive', $project);

        if (($project->archived_at !== null) === $archived) {
            return $project;
        }

        DB::transaction(function () use ($actor, $project, $archived): void {
            // restoring: the zone of the organisation as locked (K3), in the order organisation, then project
            $organization = $archived ? null : CatalogLock::share();
            $old = $project->archived_at?->toJSON();
            $project->update(['archived_at' => $archived ? now() : null]);

            EventRecorder::record(
                $archived ? EventType::ProjectArchived : EventType::ProjectRestored,
                $actor,
                $project,
                $project,
                ['archived_at' => ['old' => $old, 'new' => $project->archived_at?->toJSON()]],
            );

            if ($organization !== null) {
                // the schedules of its templates count from now: no term of the archive is caught up (A339)
                RescheduleTemplates::run($actor, $organization->timezone, $project->id);
            }
        });

        // lists without archived projects count from the next check of this request on (P33)
        Visibility::forget();

        return $project;
    }
}
