<?php

namespace App\Actions\GitHub;

use App\Access\OrgRole;
use App\Access\RoleIndex;
use App\Access\Visibility;
use App\Actions\AgentRuns\CancelRun;
use App\Actions\Comments\AddComment;
use App\Domain\Agents\RunStatus;
use App\Domain\Agents\RunType;
use App\Enums\AccountType;
use App\Enums\Locale;
use App\Events\EventRecorder;
use App\Events\EventType;
use App\Exceptions\Problem;
use App\Models\AgentRun;
use App\Models\AgentThread;
use App\Models\GitHubApp;
use App\Models\Project;
use App\Models\ProjectRepository;
use App\Models\User;
use App\Models\WorkItem;
use App\Support\Actor;
use App\Support\OwnMerges;
use Illuminate\Database\Eloquent\ModelNotFoundException;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\ValidationException;
use Lorisleiva\Actions\Concerns\AsAction;
use RuntimeException;

/**
 * The guard against an unauthorized merge (spec 11.3, A515): a `push` of the app (its bot account, `<slug>[bot]`) to the
 * base branch of a project whose commit is no merge of werkbuch (OwnMerges) is a push an agent made itself (directly or
 * by merging through the API with its token). Then every open strand of the project pauses (`guard`), what runs of it is
 * canceled and what waits waits (`merge_guard`), until a project admin confirms (ConfirmMergeGuard). Under the shared
 * lock of the project and the lock of its repo row: a second push while the guard holds changes nothing. Afterwards
 * werkbuch says so at the item of the one code run that ran in the project, if there was exactly one, and mentions the
 * org admins there (they hear of it like of any mention); `project.merge_guard_detected` says it in any case.
 * Answers `ignored` (not the app, not a base branch, no project), `own`, `pending` (a merge of werkbuch is under way:
 * look again later) or `foreign`.
 */
final class DetectUnauthorizedPush
{
    use AsAction;

    /** The reason a strand pauses with and a run waits for. */
    public const REASON = 'guard';

    public const WAITING = 'merge_guard';

    /**
     * @param  array<array-key, mixed>  $payload  the payload of a `push` delivery
     */
    public function handle(Actor $actor, array $payload): string
    {
        $app = GitHubApp::current();
        $ref = $payload['ref'] ?? null;
        $sha = $payload['after'] ?? null;
        $repository = is_array($payload['repository'] ?? null) ? $payload['repository'] : [];
        $sender = is_array($payload['sender'] ?? null) ? $payload['sender'] : [];

        if ($app === null || ! is_string($ref) || ! str_starts_with($ref, 'refs/heads/') || ($payload['deleted'] ?? false) === true
            || ! is_string($sha) || preg_match('/^[0-9a-f]{40}\z/', $sha) !== 1 || ! is_int($repository['id'] ?? null)
            || ! is_string($sender['login'] ?? null) || strcasecmp($sender['login'], $app->botLogin()) !== 0) {
            return 'ignored';
        }

        $link = ProjectRepository::query()->whereHas('repository', fn ($query) => $query->where('github_id', $repository['id']))->first();
        if ($link === null || substr($ref, strlen('refs/heads/')) !== $link->base_branch) {
            return 'ignored';
        }

        $explained = OwnMerges::explain($link->repository_id, $sha);
        if ($explained !== OwnMerges::FOREIGN) {
            return $explained;
        }

        $guard = DB::transaction(function () use ($actor, $link, $sha): ?array {
            $project = Project::query()->sharedLock()->find($link->project_id);
            $locked = ProjectRepository::query()->lockForUpdate()->find($link->id);
            if ($project === null || $project->deleting_at !== null || $locked === null || $locked->guarded()) {
                return null;
            }

            $runs = AgentRun::query()->lockForUpdate()->where('project_id', $project->id)
                ->whereIn('status', [RunStatus::Queued->value, RunStatus::Waiting->value, RunStatus::Running->value, RunStatus::Canceling->value])
                ->orderBy('id')->get();
            $coding = $runs->filter(fn (AgentRun $run) => $run->status->busy() && ! $run->type->light());
            $pusher = $coding->count() === 1 ? $coding->first() : null;

            $locked->forceFill([
                'guard_detected_at' => now(), 'guard_sha' => $sha, 'guard_branch' => $locked->base_branch,
                'guard_run_id' => $pusher?->id, 'guard_item_id' => $pusher?->work_item_id, 'guard_bot_id' => $pusher?->bot_id,
            ])->save();

            $threads = AgentThread::query()->lockForUpdate()->where('project_id', $project->id)->where('status', AgentThread::OPEN)->orderBy('id')->get();
            foreach ($threads as $thread) {
                $thread->forceFill(['status' => AgentThread::PAUSED, 'pause_reason' => self::REASON])->save();
            }

            $canceled = 0;
            foreach ($runs as $run) {
                if ($run->status === RunStatus::Running) {
                    CancelRun::stop($actor, $run);
                    $canceled++;
                } elseif ($run->status->pending()) {
                    $run->forceFill(['status' => RunStatus::Waiting, 'waiting_reason' => self::WAITING])->save();
                }
            }

            EventRecorder::record(EventType::ProjectMergeGuardDetected, $actor, $project, $project, [
                'guard' => ['old' => null, 'new' => $sha],
            ], [
                'branch' => $locked->base_branch, 'run_id' => $pusher?->id, 'item_id' => $pusher?->work_item_id,
                'bot_id' => $pusher?->bot_id, 'paused' => $threads->count(), 'canceled' => $canceled,
            ]);

            return ['project' => $project, 'item_id' => $pusher?->work_item_id, 'type' => $pusher?->type, 'branch' => $locked->base_branch];
        }, 3);

        if ($guard !== null && $guard['item_id'] !== null) {
            self::comment($actor, $guard['item_id'], $guard['project'], $guard['branch'], $sha, $guard['type']);
        }

        return 'foreign';
    }

    /**
     * Says it at the item whose run pushed, in the language of the organization, mentioning the org admins. A comment
     * that cannot be written (item archived or gone meanwhile) is reported; the guard holds anyway.
     */
    private static function comment(Actor $actor, string $itemId, Project $project, string $branch, string $sha, ?RunType $type): void
    {
        Visibility::forget();
        $admins = array_keys(array_filter(app(RoleIndex::class)->orgRoles(), fn (OrgRole $role) => $role === OrgRole::Admin));
        $handles = User::query()->whereKey($admins)->where('type', AccountType::Person)->whereNull('disabled_at')->orderBy('handle')->pluck('handle')
            ->map(fn (string $handle) => '@'.$handle)->implode(' ');

        $locale = Locale::default()->value;
        $body = __('github.guard.comment', [
            'branch' => $branch, 'sha' => substr($sha, 0, 7), 'project' => $project->identifier,
            'run' => $type === null ? '' : __('github.guard.run.'.$type->value, [], $locale), 'admins' => $handles,
        ], $locale);

        try {
            AddComment::run($actor, WorkItem::query()->findOrFail($itemId), ['body' => trim($body)]);
        } catch (Problem|ValidationException|ModelNotFoundException $e) {
            // a refusal under 500 is never reported by itself: say which item it was
            report(new RuntimeException("The guard could not comment at item {$itemId}.", 0, $e));
        }
    }
}
