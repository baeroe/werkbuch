<?php

namespace App\Actions\AgentRuns;

use App\Domain\Agents\Protocol;
use App\Domain\Agents\RunStatus;
use App\Domain\Agents\RunType;
use App\Events\EventRecorder;
use App\Events\EventType;
use App\Exceptions\Problem;
use App\GitHub\GitHubUnavailable;
use App\GitHub\InstallationTokens;
use App\Models\AgentConfig;
use App\Models\AgentProjectSettings;
use App\Models\AgentRun;
use App\Models\AgentThread;
use App\Models\Project;
use App\Models\ProjectRepository;
use App\Models\Runner;
use App\Support\Actor;
use App\Support\RunnerProtocol;
use App\Support\RunPrompts;
use App\Support\RunQueue;
use App\Support\RunTokens;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\ValidationException;
use Lorisleiva\Actions\Concerns\AsAction;
use Throwable;

/**
 * A runner asks for work (spec 6.3, 9): its report becomes its last state, then werkbuch hands it the next run it may
 * take, or none. One claim per runner at a time (its row `for update`); the places are counted from what runs on it and
 * the places set in werkbuch, a light run only in its own pot. The candidates come without a lock in the order of the
 * queue (conflicts, corrections and reviews first, then the priority of the item, then the age), the first one the
 * runner may take is read again `for update` and taken only if it still waits and its strand allows it (under the lock
 * of the strand): two runners asking at once never get the same run, a strand never runs twice. A runner speaking an older protocol gets none. The answer has everything the runner needs, the token of the
 * run among it (only here, A477); without a run `run` is null. The actor is the system (A487): the runner is no account.
 */
final class ClaimRun
{
    use AsAction;

    /** How many waiting runs one claim looks at. */
    public const CANDIDATES = 200;

    /** The error of a run GitHub gave no installation token for. */
    public const GIT_TOKEN = 'git_token';

    /** The reason a run waits while GitHub does not answer, and how long it waits (A511). */
    public const GITHUB_UNAVAILABLE = 'github_unavailable';

    public const RETRY_SECONDS = 120;

    /**
     * @param  array<array-key, mixed>  $input  the report (`load`, `clis`, `equipment`), `version` and `protocol` of the headers
     * @return array<string, mixed>
     *
     * @throws ValidationException for a report of another shape
     */
    public function handle(Actor $actor, Runner $runner, array $input): array
    {
        $report = RunnerProtocol::report($input);
        $protocol = RunnerProtocol::protocol($input['protocol'] ?? null);

        [$run, $token, $answer] = DB::transaction(function () use ($runner, $input, $report, $protocol): array {
            $locked = Runner::query()->lockForUpdate()->whereNull('revoked_at')->find($runner->id) ?? throw Problem::notFound();
            RunnerProtocol::keep($locked, $report, RunnerProtocol::version($input['version'] ?? null), $protocol);

            $run = $protocol >= Protocol::VERSION ? $this->take($locked) : null;

            return [$run, $run === null ? null : RunTokens::issue($run), RunnerProtocol::answer($locked)];
        }, 3);

        $closed = self::closedThreads($runner);

        if ($run === null || $token === null) {
            return ['run' => null, ...$answer, 'closed_threads' => $closed];
        }

        // the installation token after the commit: never HTTP under the locks of the claim (A511)
        try {
            $git = InstallationTokens::forRun($run);
        } catch (Throwable $e) {
            report($e);
            self::giveBack($run, $e);

            return ['run' => null, ...$answer, 'closed_threads' => $closed];
        }

        // the run may have been canceled while GitHub answered (the guard, a person): then it is not handed out
        if ($git !== null && AgentRun::query()->whereKey($run->id)->value('status') !== RunStatus::Running) {
            return ['run' => null, ...$answer, 'closed_threads' => $closed];
        }

        return ['run' => self::payload($run, $token, $git), ...$answer, 'closed_threads' => $closed];
    }

    /**
     * The worktree names of strands that ended on this runner lately: it removes them at once (WEBU-61); a name it no
     * longer holds costs it nothing, a week later the list no longer names it (the sweep is the fallback).
     *
     * @return list<string>
     */
    private static function closedThreads(Runner $runner): array
    {
        $names = AgentThread::query()->where('runner_id', $runner->id)->whereIn('status', [AgentThread::MERGED, AgentThread::CLOSED])
            ->where('updated_at', '>=', now()->subDays(7))->orderByDesc('updated_at')->limit(50)->get(['id', 'worktree'])
            ->map(fn (AgentThread $thread) => $thread->worktree ?: $thread->id)->all();

        return array_values($names);
    }

    /**
     * A run GitHub gave no token for goes back (A511), only if it is still this attempt. GitHub without an answer or
     * with a 5xx counts no attempt: the run waits (`github_unavailable`) until `RETRY_SECONDS` have passed. A refusal
     * (a repo the app no longer reaches) or anything else is an attempt: the first time a new one into the queue, the
     * second time it fails with `git_token`.
     */
    private static function giveBack(AgentRun $run, Throwable $cause): void
    {
        DB::transaction(function () use ($run, $cause): void {
            $locked = AgentRun::query()->lockForUpdate()->find($run->id);
            if ($locked === null || $locked->status !== RunStatus::Running || $locked->attempt !== $run->attempt) {
                return;
            }

            if ($cause instanceof GitHubUnavailable && $cause->transient()) {
                ReapLostRuns::requeue($locked, self::GITHUB_UNAVAILABLE, false, now()->addSeconds(self::RETRY_SECONDS));
            } elseif ($locked->attempt >= Protocol::MAX_ATTEMPTS) {
                FinishRun::end($locked, RunStatus::Failed, ['error' => self::GIT_TOKEN]);
            } else {
                ReapLostRuns::requeue($locked, self::GIT_TOKEN);
            }
        }, 3);
    }

    /** The first run of the queue the runner may take now, started on it. */
    private function take(Runner $runner): ?AgentRun
    {
        $clis = $runner->readyClis();
        if ($clis === []) {
            return null;
        }

        $running = RunnerProtocol::running($runner);
        $candidates = self::candidates($runner, $clis)->with('thread.runner')->get();
        $configs = AgentConfig::query()->whereIn('bot_id', $candidates->pluck('bot_id')->unique()->values())->get()->keyBy('bot_id');
        // strands a run of which could not start: their other runs wait too (two claims never lock two runs of one
        // strand each and then wait for each other's strand)
        $left = [];

        foreach ($candidates as $candidate) {
            $strand = $candidate->type === RunType::Review ? null : $candidate->thread_id;
            if (($strand !== null && isset($left[$strand]))
                || ! RunQueue::eligible($candidate, $configs->get($candidate->bot_id), $runner)
                || ! $runner->places()->fits($candidate->type, $candidate->project_id, $running)) {
                continue;
            }

            // the project first (shared, read fresh): a deletion holds it and ends the runs (A489), a claim waits for
            // it and then finds the project being deleted, never a lock the other way round
            $project = Project::query()->sharedLock()->find($candidate->project_id);
            if ($project === null || $project->deleting_at !== null) {
                continue;
            }

            // the guard against an unauthorized merge holds every run of the project (spec 11.3): the repo row shared,
            // after the project and before the run, as DetectUnauthorizedPush takes them
            if (ProjectRepository::query()->sharedLock()->where('project_id', $project->id)->whereNotNull('guard_detected_at')->exists()) {
                continue;
            }

            $locked = AgentRun::query()->lockForUpdate()->find($candidate->id);
            if ($locked === null || ! $locked->status->pending()) {
                continue;
            }

            if (($started = $this->start($locked, $runner)) !== null) {
                return $started;
            }

            if ($strand !== null) {
                $left[$strand] = true;
            }
        }

        return null;
    }

    /**
     * The waiting runs this runner could take, in the order of the queue and without a lock: what it can never take is
     * left out in SQL (A488), so a queue full of runs for other runners never hides the ones for this one. Left out are
     * runs of a project being deleted, of an agent that is off or whose pool leaves this runner out, of a CLI the runner
     * does not report ready, at a strand bound to another runner that is not gone, and at a strand that runs already
     * (reviews do not use the strand). The places and the rest are checked one by one, the strand again under its lock.
     *
     * @param  list<string>  $clis
     * @return Builder<AgentRun>
     */
    private static function candidates(Runner $runner, array $clis): Builder
    {
        $review = RunType::Review->value;

        return AgentRun::query()->select('agent_runs.*')
            ->whereIn('agent_runs.status', [RunStatus::Queued->value, RunStatus::Waiting->value])
            ->whereIn('agent_runs.cli', $clis)
            ->where(fn (Builder $due) => $due->whereNull('agent_runs.retry_at')->orWhere('agent_runs.retry_at', '<=', now()))
            ->join('projects', 'projects.id', '=', 'agent_runs.project_id')->whereNull('projects.deleting_at')
            ->whereNotExists(fn ($guard) => $guard->selectRaw('1')->from('project_repositories')
                ->whereColumn('project_repositories.project_id', 'agent_runs.project_id')->whereNotNull('project_repositories.guard_detected_at'))
            ->join('agent_configs', 'agent_configs.bot_id', '=', 'agent_runs.bot_id')->where('agent_configs.enabled', true)
            ->where(fn (Builder $pool) => $pool->whereJsonLength('agent_configs.runner_ids', 0)->orWhereJsonContains('agent_configs.runner_ids', $runner->id))
            ->leftJoin('agent_threads', 'agent_threads.id', '=', 'agent_runs.thread_id')
            ->leftJoin('runners as strand_runners', 'strand_runners.id', '=', 'agent_threads.runner_id')
            ->where(fn (Builder $bound) => $bound->where('agent_runs.type', $review)
                ->orWhereNull('agent_threads.runner_id')
                ->orWhere('agent_threads.runner_id', $runner->id)
                ->orWhereNotNull('strand_runners.revoked_at')
                ->orWhereNull('strand_runners.last_seen_at')
                ->orWhere('strand_runners.last_seen_at', '<', now()->subMinutes(Protocol::TAKEOVER_MINUTES)))
            ->where(fn (Builder $free) => $free->where('agent_runs.type', $review)
                ->orWhereNull('agent_runs.thread_id')
                ->orWhereNotExists(fn ($busy) => $busy->selectRaw('1')->from('agent_runs as strand_runs')
                    ->whereColumn('strand_runs.thread_id', 'agent_runs.thread_id')
                    ->where('strand_runs.type', '!=', $review)
                    ->whereIn('strand_runs.status', [RunStatus::Running->value, RunStatus::Canceling->value])))
            ->leftJoin('work_items', 'work_items.id', '=', 'agent_runs.work_item_id')
            ->orderByRaw("case when agent_runs.type in ('conflict', 'correction', 'review') then 0 else 1 end")
            ->orderByRaw("field(coalesce(work_items.priority, 'none'), 'urgent', 'high', 'medium', 'low', 'none')")
            ->orderBy('agent_runs.id')
            ->limit(self::CANDIDATES);
    }

    /**
     * Starts a run read `for update`, or none when it may not start after all. Locks Runner → project (shared, read in
     * `take`, A489) → run → strand (spec 9): the
     * strand row `for update`, then everything that decides again under it, read fresh (a locking read sees what others
     * committed meanwhile): the agent still on, pool and CLI, the binding of the strand and no other run at the strand.
     * Two runners taking two runs of one strand at once: the second waits for the strand and then leaves its run.
     */
    private function start(AgentRun $run, Runner $runner): ?AgentRun
    {
        $thread = $run->type === RunType::Review || $run->thread_id === null ? null : AgentThread::query()->lockForUpdate()->find($run->thread_id);
        $run->setRelation('thread', $thread?->load('runner'));
        $config = AgentConfig::query()->sharedLock()->where('bot_id', $run->bot_id)->first();

        if (! RunQueue::eligible($run, $config, $runner) || ($thread !== null && self::strandBusy($thread))) {
            return null;
        }

        if ($thread !== null) {
            $moved = $thread->runner_id !== null && $thread->runner_id !== $runner->id;
            $thread->forceFill([
                'runner_id' => $runner->id,
                // another runner takes over the strand with a fresh session (spec 9)
                'session_id' => $moved ? null : $thread->session_id,
                'branch' => $thread->branch ?? ($run->workItem === null ? null : AgentThread::branchFor($run->workItem)),
            ])->save();
        }

        $run->forceFill([
            'status' => RunStatus::Running,
            'waiting_reason' => null,
            'runner_id' => $runner->id,
            'started_at' => now(),
            'lease_expires_at' => now()->addSeconds(Protocol::LEASE_SECONDS),
        ])->save();

        EventRecorder::record(EventType::AgentRunStarted, Actor::agent($run->bot), $run, $run->project, [
            'status' => ['old' => null, 'new' => RunStatus::Running->value],
        ], ['item_id' => $run->work_item_id, 'runner_id' => $runner->id, 'attempt' => $run->attempt]);

        return $run;
    }

    /** Whether a run (but a review) of the strand runs already: one run at a strand at a time (spec 7.8, 9). */
    private static function strandBusy(AgentThread $thread): bool
    {
        return AgentRun::query()->sharedLock()->where('thread_id', $thread->id)
            ->where('type', '!=', RunType::Review->value)
            ->whereIn('status', [RunStatus::Running->value, RunStatus::Canceling->value])
            ->value('id') !== null;
    }

    /**
     * What the runner needs to run it (spec 6.3): `git` is the repo of the project and an installation token for it
     * with the permissions of the kind (spec 11.3, null for a project without a repo), the setup and teardown commands of
     * the project (spec 8.4) and the prompts built from their layers (spec 7.3, RunPrompts).
     *
     * @param  array{repo_url: string, token: string, expires_at: string}|null  $git
     * @return array<string, mixed>
     */
    private static function payload(AgentRun $run, string $token, ?array $git): array
    {
        $item = $run->workItem;
        $thread = $run->type === RunType::Review ? null : $run->thread;
        $bot = $run->bot;
        $host = parse_url((string) config('app.url'), PHP_URL_HOST);
        $settings = AgentProjectSettings::of($run->project_id);

        return [
            'id' => $run->id,
            'attempt' => $run->attempt,
            'type' => $run->type->value,
            'cli' => $run->cli->value,
            'model' => $run->model,
            'model_source' => $run->model_source,
            'timeout_minutes' => $run->type->timeoutMinutes(),
            'deadline_at' => $run->deadline()?->toJSON(),
            'lease_expires_at' => $run->lease_expires_at?->toJSON(),
            'project' => ['id' => $run->project->id, 'identifier' => $run->project->identifier],
            'item' => $item === null ? null : ['id' => $item->id, 'key' => $item->key, 'title' => $item->title],
            'thread' => $thread === null ? null : [
                'id' => $thread->id, 'branch' => $thread->branch, 'base_branch' => $thread->base_branch,
                'worktree' => $thread->worktree, 'session_id' => $thread->session_id,
            ],
            'head_sha' => $run->head_sha,
            'setup_command' => $settings->setup_command,
            'stop_command' => $settings->stop_command,
            'teardown_command' => $settings->teardown_command,
            'commit_identity' => ['name' => $bot->name, 'email' => $bot->handle.'@users.noreply.'.(is_string($host) ? $host : 'localhost')],
            ...RunPrompts::for($run),
            'werkbuch' => ['mcp_url' => url('/mcp'), 'server_name' => Protocol::MCP_SERVER, 'token' => $token],
            'git' => $git,
        ];
    }
}
