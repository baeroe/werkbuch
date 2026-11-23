<?php

namespace App\Actions\Projects;

use App\Access\Authorize;
use App\Access\Visibility;
use App\Actions\AgentRuns\FinishRun;
use App\Domain\Agents\RunStatus;
use App\Events\EventRecorder;
use App\Events\EventType;
use App\Exceptions\Problem;
use App\Jobs\PurgeProject as PurgeProjectJob;
use App\Models\AgentRun;
use App\Models\Project;
use App\Support\Actor;
use App\Support\ProjectLock;
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
            // the fresh row: a retry after a deadlock (3 attempts) starts from what the database holds, not from the
            // model of the attempt before
            $locked = ProjectLock::lock($project);
            $locked->update(['deleting_at' => now()]);
            $project->setRawAttributes($locked->getAttributes(), true);

            // the runs of the project end now (A489): a pending one never starts, a busy one is canceled like a revoked
            // runner's (its runner gets 409 on its next call), and their tokens go before the project does
            $runs = AgentRun::query()->lockForUpdate()->where('project_id', $project->id)
                ->whereIn('status', [RunStatus::Queued->value, RunStatus::Waiting->value, RunStatus::Running->value, RunStatus::Canceling->value])
                ->orderBy('id')->get();
            foreach ($runs as $run) {
                FinishRun::end($run, RunStatus::Canceled, ['canceled_by' => $actor->user->id, 'error' => 'project_deleted']);
            }
            EventRecorder::record(EventType::ProjectDeleted, $actor, $project, $project, null, [
                'identifier' => $project->identifier,
                'name' => $project->name,
            ]);

            PurgeProjectJob::dispatch($project->id, $actor->user->id)->afterCommit();
        }, 3);

        // nobody sees the project any more, from the next check of this request on (P33)
        Visibility::forget();
    }
}
