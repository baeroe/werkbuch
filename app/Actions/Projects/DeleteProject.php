<?php

namespace App\Actions\Projects;

use App\Access\Authorize;
use App\Access\Visibility;
use App\Events\EventRecorder;
use App\Events\EventType;
use App\Exceptions\Problem;
use App\Jobs\PurgeProject as PurgeProjectJob;
use App\Models\Project;
use App\Support\Actor;
use App\Support\MemberInput;
use Illuminate\Support\Facades\DB;
use Lorisleiva\Actions\Concerns\AsAction;

/**
 * Deletes a project with everything in it (its admins; the interface asks to type the identifier first, spec 4.4). The
 * project disappears for everybody at once (`deleting_at`, P10); the job App\Jobs\PurgeProject removes it and its data
 * on the queue `bulk` after the commit. The event `project.deleted` stays, so later consumers (webhooks) still learn
 * which project it was.
 */
final class DeleteProject
{
    use AsAction;

    /**
     * @throws Problem 404 for a project that is being deleted already (or gone meanwhile)
     */
    public function handle(Actor $actor, Project $project): void
    {
        Authorize::check($actor, 'delete', $project);

        DB::transaction(function () use ($actor, $project): void {
            // a second deletion at the same time finds the first one's mark (or no project any more): no second event,
            // no second job
            MemberInput::lock($project);

            $project->update(['deleting_at' => now()]);
            EventRecorder::record(EventType::ProjectDeleted, $actor, $project, $project, null, [
                'identifier' => $project->identifier,
                'name' => $project->name,
            ]);

            PurgeProjectJob::dispatch($project->id, $actor->user->id)->afterCommit();
        });

        // nobody sees the project any more, from the next check of this request on (P33)
        Visibility::forget();
    }
}
