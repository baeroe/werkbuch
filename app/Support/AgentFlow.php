<?php

namespace App\Support;

use App\Access\Permission;
use App\Access\Visibility;
use App\Actions\Comments\AddComment;
use App\Actions\WorkItems\TransitionWorkItem;
use App\Actions\WorkItems\UpdateWorkItem;
use App\Domain\Agents\RunStatus;
use App\Domain\Agents\RunType;
use App\Domain\Workflow\AgentStep;
use App\Domain\Workflow\StateCategory;
use App\Enums\Locale;
use App\Exceptions\Problem;
use App\Models\AgentConfig;
use App\Models\AgentRun;
use App\Models\AgentThread;
use App\Models\Comment;
use App\Models\Project;
use App\Models\ProjectRepository;
use App\Models\User;
use App\Models\Workflow;
use App\Models\WorkItem;
use App\Models\WorkItemLink;
use Illuminate\Database\Eloquent\ModelNotFoundException;
use Illuminate\Support\Collection;
use Illuminate\Validation\ValidationException;
use RuntimeException;

/**
 * What the flow of the agents (spec 7) needs again and again, for the actions under `App\Actions\Agents`: whether a bot
 * may work as an agent in a project, the strand of an item, a move of an item to the state of a step, an assignment
 * and a comment of the agent. Moves, assignments and comments are the agent's (`Actor::agent`): never a trigger.
 */
final class AgentFlow
{
    /** How long a PR without any check waits before it counts as green, and a strand for the PR of its task (spec 7.2). */
    public const SETTLE_MINUTES = 2;

    /** The answers of `refusal`, in its order. */
    public const REFUSALS = ['agent_off', 'default_bot', 'disabled', 'no_owner', 'archived', 'no_steps', 'not_member'];

    /**
     * Why a bot cannot work on items of a project as an agent (spec 7.2, 7.4), null when it can: an agent switched on,
     * a bot with a responsible person (not the default bot), active, that may edit items of the project, and a workflow
     * that names every step of the agents; the project neither archived nor being deleted. The default bot, a deactivated
     * bot and one without a responsible person each have their own code (A647).
     */
    public static function refusal(User $bot, Project $project): ?string
    {
        $config = AgentConfig::query()->where('bot_id', $bot->id)->first();
        $workflow = Workflow::query()->find($project->workflow_id);

        return match (true) {
            ! $bot->isBot() || $config === null || ! $config->enabled => 'agent_off',
            $bot->is_default_bot => 'default_bot',
            $bot->isDisabled() => 'disabled',
            $bot->owner_id === null => 'no_owner',
            $project->archived_at !== null || $project->deleting_at !== null => 'archived',
            $workflow === null || ! $workflow->agentStepsComplete() => 'no_steps',
            ! Visibility::can($bot, Permission::ItemEdit, $project) => 'not_member',
            default => null,
        };
    }

    /** The open or paused strand of an item (or epic), when it has one: not locked, lock it with `lockStrand`. */
    public static function threadAt(string $itemId): ?AgentThread
    {
        return AgentThread::query()->where('work_item_id', $itemId)
            ->whereIn('status', [AgentThread::OPEN, AgentThread::PAUSED])->orderByDesc('id')->first();
    }

    /**
     * Locks a strand as every action of the flow does, after its item: the runs of the strand that have not ended, then
     * the strand row (A592: item → runs → strand, as FinishRun and the claim lock run → strand). Answers both.
     *
     * @return array{0: Collection<int, AgentRun>, 1: AgentThread}
     */
    public static function lockStrand(AgentThread $thread): array
    {
        $runs = self::openRuns($thread);

        return [$runs, AgentThread::query()->lockForUpdate()->findOrFail($thread->id)];
    }

    /** The kinds of runs that change code: while one of them waits or runs, CI and review of the strand decide nothing. */
    public const CODE = [RunType::Task, RunType::Correction, RunType::Conflict];

    /**
     * Whether a run of a strand that changes code has not ended (A593): a push of it in between is no state to judge,
     * the end of the run looks at the head again (HandleRunResult).
     */
    public static function coding(AgentThread $thread): bool
    {
        return AgentRun::query()->where('thread_id', $thread->id)->whereIn('type', array_map(fn (RunType $type) => $type->value, self::CODE))
            ->whereIn('status', [RunStatus::Queued->value, RunStatus::Waiting->value, RunStatus::Running->value, RunStatus::Canceling->value])->exists();
    }

    /**
     * Whether the strand of an epic with children still works through them (spec 7.6, A594): its PR is reviewed and
     * merged only once werkbuch made it ready (`ready_requested_at`, ReadyEpic), draft or not.
     */
    public static function epicPending(AgentThread $thread): bool
    {
        return $thread->ready_requested_at === null && WorkItem::query()->whereKey($thread->work_item_id)->whereHas('type', fn ($query) => $query->where('is_epic', true))->exists()
            && WorkItem::query()->where('parent_id', $thread->work_item_id)->exists();
    }

    /** Whether the guard against an unauthorized merge holds the project (spec 11.3): nothing merges then. */
    public static function guarded(string $projectId): bool
    {
        return ProjectRepository::query()->where('project_id', $projectId)->whereNotNull('guard_detected_at')->exists();
    }

    /** The repo of a project as a strand starts with it: its GitHub ID and base branch, nothing without one. */
    public static function repositoryOf(string $projectId): ?ProjectRepository
    {
        return ProjectRepository::query()->with('repository')->where('project_id', $projectId)->first();
    }

    /**
     * Moves an item to the state of a step as the agent, with the check of the transition (spec 7.2): an item already
     * there, archived or closed stays; a move the workflow refuses leaves the state and says so in a comment.
     */
    public static function move(User $bot, WorkItem $item, AgentStep $step): void
    {
        $locked = ItemLock::take($item);
        $workflow = Workflow::query()->with('states')->find($locked->project->workflow_id);
        $state = $workflow?->agentState($step);

        // a canceled item stays canceled, also when its PR is merged after all (a person decided, A595)
        $category = $locked->state->category;
        if ($state === null || $locked->archived_at !== null || $locked->state_id === $state || $category === StateCategory::Canceled
            || ($step !== AgentStep::Merged && $category->isClosed())) {
            return;
        }

        try {
            TransitionWorkItem::move(Actor::agent($bot), $locked, $state, null);
        } catch (Problem) {
            $names = $workflow->states->pluck('name', 'id');
            self::comment($bot, $locked, __('agents.comment.not_moved', ['from' => $names[$locked->state_id] ?? '?', 'to' => $names[$state] ?? '?'], self::locale()));
        }
    }

    /** Gives an item to an account as the agent (a strand at its brake goes to the owner, an epic child to the bot). */
    public static function assign(User $bot, WorkItem $item, string $userId): void
    {
        $locked = ItemLock::take($item);
        if ($locked->assignee_id === $userId || $locked->archived_at !== null) {
            return;
        }

        try {
            UpdateWorkItem::apply(Actor::agent($bot), $locked, ['assignee_id' => $userId]);
        } catch (ValidationException|Problem $e) {
            report(new RuntimeException("The agent could not assign item {$item->id}.", 0, $e));
        }
    }

    /**
     * A comment of the agent at an item in Markdown; one that cannot be written (gone, archived) is reported. A comment
     * that answers a run names it (`$runId`, A643): the item links the card of the run.
     */
    public static function comment(User $bot, WorkItem $item, string $markdown, ?string $runId = null): void
    {
        try {
            AddComment::run(Actor::agent($bot), $item, ['body' => $markdown], $runId);
        } catch (Problem|ValidationException|ModelNotFoundException $e) {
            report(new RuntimeException("The agent could not comment at item {$item->id}.", 0, $e));
        }
    }

    /** The language of what werkbuch writes for the agents: the language of the organization. */
    public static function locale(): string
    {
        return Locale::default()->value;
    }

    /**
     * The runs of a strand that have not ended, locked (runs before the strand, as FinishRun and the claim lock them).
     *
     * @return Collection<int, AgentRun>
     */
    public static function openRuns(AgentThread $thread, ?RunType $type = null): Collection
    {
        return AgentRun::query()->lockForUpdate()->where('thread_id', $thread->id)
            ->whereIn('status', [RunStatus::Queued->value, RunStatus::Waiting->value, RunStatus::Running->value, RunStatus::Canceling->value])
            ->when($type !== null, fn ($query) => $query->where('type', $type?->value))->orderBy('id')->get();
    }

    /**
     * What people wrote at the item since the last run of the strand ended: the findings of a correction a person set
     * off (spec 7.2). Comments of bots do not count.
     */
    public static function commentsSince(AgentThread $thread, WorkItem $item): string
    {
        $since = AgentRun::query()->where('thread_id', $thread->id)->whereNotNull('finished_at')->max('finished_at');
        $comments = Comment::query()->with('author')->where('work_item_id', $item->id)
            ->when($since !== null, fn ($query) => $query->where('created_at', '>', $since))
            ->whereIn('author_id', User::query()->select('id')->where('type', 'person'))
            ->orderBy('created_at')->orderBy('id')->get();

        return $comments->isEmpty()
            ? (string) __('agents.findings.no_comments', [], self::locale())
            : $comments->map(fn (Comment $comment) => "{$comment->author->name}: {$comment->body_text}")->implode("\n\n");
    }

    /** The link of the PR of a strand at its item (the PR names the item in its branch). */
    public static function linkOf(AgentThread $thread): ?WorkItemLink
    {
        return $thread->pr_number === null || $thread->repository_github_id === null ? null
            : WorkItemLink::query()->with('checks')->where('repository_github_id', $thread->repository_github_id)->where('number', $thread->pr_number)
                ->orderByRaw('work_item_id = ? desc', [$thread->work_item_id])->orderBy('id')->first();
    }

    /**
     * The state of the CI of a link at its head commit (spec 7.2): from its check runs. Without any it is green only
     * when werkbuch asked GitHub for the check runs of that commit at least two minutes after it came and GitHub had none
     * (A591: a repo without CI); else it stays `none` and the sweep asks GitHub (LoadChecks).
     */
    public static function ci(WorkItemLink $link): string
    {
        $state = $link->ci();

        return $state === 'none' && self::askedLate($link) ? 'success' : $state;
    }

    /** Whether werkbuch asked GitHub for the check runs of the head commit of a link once the commit had settled. */
    public static function askedLate(WorkItemLink $link): bool
    {
        return $link->head_seen_at !== null && $link->checks_loaded_sha === $link->head_sha && $link->checks_loaded_at !== null
            && $link->checks_loaded_at->gte($link->head_seen_at->copy()->addMinutes(self::SETTLE_MINUTES));
    }
}
