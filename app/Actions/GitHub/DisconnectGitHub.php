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
use App\Models\Organization;
use App\Models\Project;
use App\Models\ProjectRepository;
use App\Support\Actor;
use App\Support\CatalogLock;
use Illuminate\Support\Facades\DB;
use Lorisleiva\Actions\Concerns\AsAction;

/**
 * Disconnects the app of a GitHub account (spec 10.2, A680): werkbuch forgets the app, its installations and repos (the
 * app stays at GitHub until somebody deletes it there), the projects with a repo of this app lose it (and a guard with
 * it); the other apps and their projects stay as they are. The open strands of those projects pause (`github`, also the
 * ones the guard paused), and what runs or waits in them is canceled: it could no longer push. PR and branch stay at
 * GitHub; a strand goes on when its item is assigned to the bot again (WEBU-26) or by „Weitermachen“ (WEBU-28). Org
 * admins, only from the session (A397); answers how many runs it canceled. A delivery of the app keeps its row
 * without the app (it is never worked).
 */
final class DisconnectGitHub
{
    use AsAction;

    public const REASON = 'github';

    /**
     * @throws Problem 403, 404 for an app that is not (or no longer) connected
     */
    public function handle(Actor $actor, GitHubApp|string $app): int
    {
        Authorize::check($actor, 'manageGitHub', Organization::class);
        $id = $app instanceof GitHubApp ? $app->id : strtolower($app);

        return DB::transaction(function () use ($actor, $id): int {
            CatalogLock::take();
            // gone meanwhile (disconnected by someone else): as unknown
            $app = GitHubApp::query()->lockForUpdate()->find($id) ?? throw Problem::notFound();

            // project → repo → run, as the claim and the guard take them (shared projects, then the rows of the repos);
            // only the projects whose repo this app reaches
            $projects = ProjectRepository::query()->whereHas('repository.installation', fn ($query) => $query->where('github_app_id', $app->id))
                ->pluck('project_id')->all();
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

            // the repos and the links of the projects go with the installations of the app
            $app->installations()->delete();
            $app->delete();

            EventRecorder::record(EventType::GitHubDisconnected, $actor, Organization::current(), null, [
                'app' => ['old' => $app->slug, 'new' => null],
            ], ['owner' => $app->owner_login, 'projects' => count($projects), 'canceled' => $runs->count()]);

            return $runs->count();
        }, 3);
    }
}
