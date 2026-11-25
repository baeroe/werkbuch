<?php

namespace App\Actions\GitHub;

use App\Actions\AgentRuns\CancelRun;
use App\Actions\Comments\AddComment;
use App\Domain\Agents\RunStatus;
use App\Domain\Agents\RunType;
use App\Enums\Locale;
use App\Events\EventRecorder;
use App\Events\EventType;
use App\Exceptions\Problem;
use App\Models\AgentRun;
use App\Models\AgentThread;
use App\Models\Project;
use App\Models\ProjectRepository;
use App\Models\WorkItem;
use App\Support\Actor;
use App\Support\OwnMerges;
use Illuminate\Database\Eloquent\Collection;
use Illuminate\Database\Eloquent\ModelNotFoundException;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\ValidationException;
use Lorisleiva\Actions\Concerns\AsAction;
use RuntimeException;

/**
 * The guard against an unauthorized merge (spec 11.3, A515): a `push` of the app of the repo (its bot account,
 * `<slug>[bot]`, A680) to the base branch of a project whose commit is no merge of werkbuch (OwnMerges), or the app deleting the base branch, is
 * something an agent did itself (directly or by merging through the API with its token). Then every open strand of the
 * project pauses (`guard`), what runs of it is canceled and what waits waits (`merge_guard`), until a project admin
 * confirms (ConfirmMergeGuard). Locks: the project shared, its repo row (the base branch compared again there), its
 * runs, then its strands: a second push while the guard holds changes nothing. `project.merge_guard_detected` tells every
 * active org admin (the notification `merge_guard_detected`, always); werkbuch says it besides at the items of the runs
 * it takes for the push (`suspects`). Answers `ignored` (not the app, not a base branch, no project), `own`, `pending`
 * (a merge of werkbuch is under way: look again later) or `foreign`.
 */
final class DetectUnauthorizedPush
{
    use AsAction;

    /** The reason a strand pauses with and a run waits for. */
    public const REASON = 'guard';

    public const WAITING = 'merge_guard';

    /** How long a run may have pushed after it began: an installation token lives an hour, a renewed one as long. */
    public const TOKEN_MINUTES = 60;

    /** How far back a commit a run reported can be the push (a webhook late by a day still finds its run). */
    public const COMMIT_HOURS = 24;

    private const ZERO = '0000000000000000000000000000000000000000';

    /**
     * @param  array<array-key, mixed>  $payload  the payload of a `push` delivery
     */
    public function handle(Actor $actor, array $payload): string
    {
        $ref = $payload['ref'] ?? null;
        $deleted = ($payload['deleted'] ?? false) === true;
        // a deleted branch has no commit after the push: the one it pointed at is what went
        $sha = $deleted ? ($payload['before'] ?? null) : ($payload['after'] ?? null);
        $repository = is_array($payload['repository'] ?? null) ? $payload['repository'] : [];
        $sender = is_array($payload['sender'] ?? null) ? $payload['sender'] : [];

        if (! is_string($ref) || ! str_starts_with($ref, 'refs/heads/') || ! is_string($sha)
            || preg_match('/^[0-9a-f]{40}\z/', $sha) !== 1 || $sha === self::ZERO || ! is_int($repository['id'] ?? null)
            || ! is_string($sender['login'] ?? null)) {
            return 'ignored';
        }

        $branch = substr($ref, strlen('refs/heads/'));
        $link = ProjectRepository::query()->with('repository.installation.app')->whereHas('repository', fn ($query) => $query->where('github_id', $repository['id']))->first();
        // only the bot of the app whose installation reaches the repo pushes for agents (A680: one app per account)
        if ($link === null || $branch !== $link->base_branch || strcasecmp($sender['login'], $link->repository->installation->app->botLogin()) !== 0) {
            return 'ignored';
        }

        $explained = $deleted ? OwnMerges::FOREIGN : OwnMerges::explain($link->repository_id, $sha);
        if ($explained !== OwnMerges::FOREIGN) {
            return $explained;
        }

        $commits = self::commits($payload, $sha);
        $guard = DB::transaction(function () use ($actor, $link, $sha, $branch, $deleted, $commits): ?array {
            $project = Project::query()->sharedLock()->find($link->project_id);
            $locked = ProjectRepository::query()->lockForUpdate()->find($link->id);
            // under the lock again: the base branch may have changed, the guard may hold already
            if ($project === null || $project->deleting_at !== null || $locked === null || $locked->guarded() || $locked->base_branch !== $branch) {
                return null;
            }

            $suspects = self::suspects($project, $commits);
            $runs = $suspects->map(fn (AgentRun $run) => ['run_id' => $run->id, 'item_id' => $run->work_item_id, 'bot_id' => $run->bot_id])->values()->all();
            $locked->forceFill(['guard_detected_at' => now(), 'guard_sha' => $sha, 'guard_branch' => $branch, 'guard_runs' => $runs])->save();

            // runs before strands, as FinishRun and DisconnectGitHub lock them: a run that reports its result while the
            // push comes waits here or makes this wait, never both
            $canceled = 0;
            $open = AgentRun::query()->lockForUpdate()->where('project_id', $project->id)
                ->whereIn('status', [RunStatus::Queued->value, RunStatus::Waiting->value, RunStatus::Running->value])->orderBy('id')->get();
            foreach ($open as $run) {
                if ($run->status === RunStatus::Running) {
                    CancelRun::stop($actor, $run);
                    $canceled++;
                } else {
                    $run->forceFill(['status' => RunStatus::Waiting, 'waiting_reason' => self::WAITING])->save();
                }
            }

            $threads = AgentThread::query()->lockForUpdate()->where('project_id', $project->id)->where('status', AgentThread::OPEN)->orderBy('id')->get();
            foreach ($threads as $thread) {
                $thread->forceFill(['status' => AgentThread::PAUSED, 'pause_reason' => self::REASON])->save();
            }

            $items = array_values(array_unique(array_filter(array_column($runs, 'item_id'))));
            EventRecorder::record(EventType::ProjectMergeGuardDetected, $actor, $project, $project, [
                'guard' => ['old' => null, 'new' => $sha],
            ], ['branch' => $branch, 'deleted' => $deleted, 'runs' => $runs, 'item_ids' => $items, 'paused' => $threads->count(), 'canceled' => $canceled]);

            return ['project' => $project, 'runs' => $suspects];
        }, 3);

        if ($guard !== null) {
            foreach ($guard['runs']->unique('work_item_id') as $run) {
                if ($run->work_item_id !== null) {
                    self::comment($actor, $run->work_item_id, $guard['project'], $branch, $sha, $run->type, $deleted);
                }
            }
        }

        return 'foreign';
    }

    /**
     * The commits of the push: the one it ended at and every commit it brought.
     *
     * @param  array<array-key, mixed>  $payload
     * @return list<string>
     */
    private static function commits(array $payload, string $sha): array
    {
        $commits = is_array($payload['commits'] ?? null) ? $payload['commits'] : [];
        $ids = array_map(fn (mixed $commit) => is_array($commit) && is_string($commit['id'] ?? null) ? strtolower($commit['id']) : null, $commits);

        return array_values(array_unique([$sha, ...array_filter($ids)]));
    }

    /**
     * The runs werkbuch takes for the push (spec 6.4: a run that changes code reports the commit it pushed): first the
     * code runs of the project that reported a commit of the push (a short one as its beginning) in the last
     * `COMMIT_HOURS`; else every code run of the project that ran within the life of a token (`TOKEN_MINUTES`), running
     * or finished since. Several suspects: all of them.
     *
     * @param  list<string>  $commits
     * @return Collection<int, AgentRun>
     */
    private static function suspects(Project $project, array $commits): Collection
    {
        $code = [RunType::Task->value, RunType::Correction->value, RunType::Conflict->value];
        $reported = AgentRun::query()->where('project_id', $project->id)->whereIn('type', $code)->whereNotNull('result')
            ->where('finished_at', '>=', now()->subHours(self::COMMIT_HOURS))->orderBy('id')->get()
            ->filter(function (AgentRun $run) use ($commits): bool {
                $commit = $run->result['commit'] ?? null;

                return is_string($commit) && collect($commits)->contains(fn (string $sha) => str_starts_with($sha, strtolower($commit)));
            })->values();

        if ($reported->isNotEmpty()) {
            return $reported;
        }

        return AgentRun::query()->where('project_id', $project->id)->whereIn('type', $code)->whereNotNull('started_at')
            ->where(fn ($query) => $query->whereIn('status', [RunStatus::Running->value, RunStatus::Canceling->value])
                ->orWhere('finished_at', '>=', now()->subMinutes(self::TOKEN_MINUTES)))
            ->orderBy('id')->get();
    }

    /**
     * Says it at an item whose run werkbuch takes for the push, in the language of the organization. A comment that
     * cannot be written (item archived or gone meanwhile) is reported; the guard holds anyway and the org admins hear of
     * it through their notification.
     */
    private static function comment(Actor $actor, string $itemId, Project $project, string $branch, string $sha, RunType $type, bool $deleted): void
    {
        $locale = Locale::default()->value;
        $body = __($deleted ? 'github.guard.comment_deleted' : 'github.guard.comment', [
            'branch' => $branch, 'sha' => substr($sha, 0, 7), 'project' => $project->identifier,
            'run' => __('github.guard.run.'.$type->value, [], $locale),
        ], $locale);

        try {
            AddComment::run($actor, WorkItem::query()->findOrFail($itemId), ['body' => $body]);
        } catch (Problem|ValidationException|ModelNotFoundException $e) {
            // a refusal under 500 is never reported by itself: say which item it was
            report(new RuntimeException("The guard could not comment at item {$itemId}.", 0, $e));
        }
    }
}
