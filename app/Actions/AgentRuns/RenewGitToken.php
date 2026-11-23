<?php

namespace App\Actions\AgentRuns;

use App\Domain\Agents\RunStatus;
use App\Exceptions\Problem;
use App\GitHub\GitHubUnavailable;
use App\GitHub\InstallationTokens;
use App\Models\AgentRun;
use App\Models\ProjectRepository;
use App\Models\Runner;
use App\Support\Actor;
use App\Support\RunAttempts;
use App\Support\RunnerProtocol;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\ValidationException;
use Lorisleiva\Actions\Concerns\AsAction;

/**
 * A new installation token for a running run (spec 6.4: a token lives an hour, the runner asks before it runs out): the
 * same repo and permissions as the one of the claim, `{git: {repo_url, token, expires_at}}` with the answer every request
 * gets. Only the runner of the run in its current attempt (409 `run_replaced` otherwise), only while it runs (409
 * `run_canceling` once it is being canceled) and the guard does not hold its project (409 `merge_guard_open`); checked
 * in a short transaction, GitHub asked after it. A project without a repo is 409 `no_repository`, a repo the app no longer
 * reaches 409 `repository_unavailable`, GitHub refusing 503 `github_unavailable`. The token is in this answer only.
 */
final class RenewGitToken
{
    use AsAction;

    /**
     * @param  array<array-key, mixed>  $input  `attempt`
     * @return array<string, mixed>
     *
     * @throws ValidationException
     * @throws Problem
     */
    public function handle(Actor $actor, Runner $runner, string $runId, array $input): array
    {
        $run = DB::transaction(function () use ($runner, $runId, $input): AgentRun {
            $run = RunAttempts::lock($runner, $runId, $input['attempt'] ?? null);
            if ($run->status !== RunStatus::Running) {
                throw Problem::conflict('run_canceling');
            }
            if (ProjectRepository::query()->where('project_id', $run->project_id)->whereNotNull('guard_detected_at')->exists()) {
                throw Problem::conflict('merge_guard_open');
            }

            return $run;
        }, 3);

        try {
            $git = InstallationTokens::forRun($run);
        } catch (GitHubUnavailable $e) {
            if ($e->reason === GitHubUnavailable::UNREACHABLE) {
                throw Problem::conflict('repository_unavailable');
            }

            report($e);

            throw Problem::unavailable('github_unavailable');
        }

        return ['git' => $git ?? throw Problem::conflict('no_repository'), ...RunnerProtocol::answer($runner)];
    }
}
