<?php

namespace App\Actions\GitHub;

use App\Access\Authorize;
use App\Events\EventRecorder;
use App\Events\EventType;
use App\Exceptions\Problem;
use App\Models\AgentThread;
use App\Models\Project;
use App\Models\ProjectRepository;
use App\Support\Actor;
use App\Support\ProjectLock;
use App\Support\RunQueue;
use Illuminate\Support\Facades\DB;
use Lorisleiva\Actions\Concerns\AsAction;

/**
 * A project admin confirms an unauthorized merge was looked at (spec 11.3): the guard goes, the strands it paused are
 * open again and runs of the project may start. Picking up what the guard held back (a correction for each strand it
 * paused, the assignments made meanwhile) is the flow's (WEBU-26, A516); `project.merge_guard_confirmed` names the
 * strands. Nothing to confirm is 409 `nothing_to_confirm`.
 */
final class ConfirmMergeGuard
{
    use AsAction;

    /**
     * @throws Problem 403, 404, 409 `nothing_to_confirm`
     */
    public function handle(Actor $actor, Project|string $project): ProjectRepository
    {
        $project = is_string($project) ? (Project::findByReference($project) ?? throw Problem::notFound()) : $project;
        Authorize::check($actor, 'manageRepository', $project);

        $link = DB::transaction(function () use ($actor, $project): ProjectRepository {
            $locked = ProjectLock::lock($project);
            $link = ProjectRepository::query()->lockForUpdate()->where('project_id', $locked->id)->first();
            if ($link === null || ! $link->guarded()) {
                throw Problem::conflict('nothing_to_confirm');
            }

            $threads = AgentThread::query()->lockForUpdate()->where('project_id', $locked->id)
                ->where('status', AgentThread::PAUSED)->where('pause_reason', DetectUnauthorizedPush::REASON)->orderBy('id')->get();
            foreach ($threads as $thread) {
                $thread->forceFill(['status' => AgentThread::OPEN, 'pause_reason' => null])->save();
            }

            $sha = $link->guard_sha;
            $branch = $link->guard_branch;
            $link->forceFill(ProjectRepository::GUARD)->save();

            EventRecorder::record(EventType::ProjectMergeGuardConfirmed, $actor, $locked, $locked, [
                'guard' => ['old' => $sha, 'new' => null],
            ], ['branch' => $branch, 'thread_ids' => $threads->pluck('id')->values()->all()]);

            return $link;
        }, 3);

        // the runs of the project waited with the reason `merge_guard`: now a runner may take them
        RunQueue::refreshReasons();

        return $link->load('repository');
    }
}
