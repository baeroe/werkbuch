<?php

namespace App\Actions\GitHub;

use App\Access\Authorize;
use App\Actions\AgentRuns\CancelRun;
use App\Domain\Agents\RunStatus;
use App\Events\EventRecorder;
use App\Events\EventType;
use App\Exceptions\Problem;
use App\Models\AgentRun;
use App\Models\AgentThread;
use App\Models\GitHubApp;
use App\Models\GitHubInstallation;
use App\Models\Organization;
use App\Models\Project;
use App\Models\ProjectRepository;
use App\Support\Actor;
use App\Support\CatalogLock;
use Illuminate\Support\Facades\DB;
use Lorisleiva\Actions\Concerns\AsAction;

/**
 * Disconnects GitHub (spec 10.2, like the click dummy): werkbuch forgets the app, its installations and repos (the app
 * stays at GitHub until somebody deletes it there), the projects lose their repo (and a guard with it). The open strands
 * of projects that had one pause (`github`, also the ones the guard paused), and what runs or waits in them is canceled:
 * it could no longer push. PR and branch stay at GitHub; a strand goes on when its item is assigned to the bot again
 * (WEBU-26). Org admins, only from the session (A397); answers how many runs it canceled.
 */
final class DisconnectGitHub
{
    use AsAction;

    public const REASON = 'github';

    /**
     * @throws Problem 403, 409 `github_not_connected`
     */
    public function handle(Actor $actor): int
    {
        Authorize::check($actor, 'manageGitHub', Organization::class);

        return DB::transaction(function () use ($actor): int {
            CatalogLock::take();
            $app = GitHubApp::query()->lockForUpdate()->first() ?? throw Problem::conflict('github_not_connected');

            // project → repo → run, as the claim and the guard take them (shared projects, then the rows of the repos)
            $projects = ProjectRepository::query()->pluck('project_id')->all();
            Project::query()->whereIn('id', $projects ?: [''])->orderBy('id')->sharedLock()->get();
            ProjectRepository::query()->whereIn('project_id', $projects ?: [''])->orderBy('id')->lockForUpdate()->get();

            $runs = AgentRun::query()->lockForUpdate()->whereIn('project_id', $projects ?: [''])
                ->whereIn('status', [RunStatus::Queued->value, RunStatus::Waiting->value, RunStatus::Running->value])->orderBy('id')->get();
            foreach ($runs as $run) {
                CancelRun::stop($actor, $run);
            }

            AgentThread::query()->lockForUpdate()->whereIn('project_id', $projects ?: [''])
                ->where(fn ($query) => $query->where('status', AgentThread::OPEN)
                    ->orWhere(fn ($paused) => $paused->where('status', AgentThread::PAUSED)->where('pause_reason', DetectUnauthorizedPush::REASON)))
                ->orderBy('id')->get()
                ->each(fn (AgentThread $thread) => $thread->forceFill(['status' => AgentThread::PAUSED, 'pause_reason' => self::REASON])->save());

            // the repos and the links of the projects go with their installations
            GitHubInstallation::query()->delete();
            $app->delete();

            EventRecorder::record(EventType::GitHubDisconnected, $actor, Organization::current(), null, [
                'app' => ['old' => $app->slug, 'new' => null],
            ], ['projects' => count($projects), 'canceled' => $runs->count()]);

            return $runs->count();
        }, 3);
    }
}
