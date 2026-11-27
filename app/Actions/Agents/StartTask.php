<?php

namespace App\Actions\Agents;

use App\Actions\AgentRuns\CancelRun;
use App\Actions\AgentRuns\EnqueueRun;
use App\Domain\Agents\RunStatus;
use App\Domain\Agents\RunType;
use App\Domain\Workflow\StateCategory;
use App\Exceptions\Problem;
use App\Models\AgentRun;
use App\Models\AgentThread;
use App\Models\ProjectRepository;
use App\Models\User;
use App\Models\Workflow;
use App\Models\WorkItem;
use App\Support\Actor;
use App\Support\AgentFlow;
use App\Support\ItemLock;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Support\Facades\DB;
use Lorisleiva\Actions\Concerns\AsAction;

/**
 * An item (or epic) assigned to an agent (spec 7.1, 7.2, 7.6): a new strand and its first `task`, or what the strand
 * the item has needs:
 * - the strand of the bot (open or paused): a `correction` with what people wrote since its last run; the brakes start
 *   again (spec 7.2, „Mensch greift ein“);
 * - a strand of another bot: it pauses, the new bot starts afresh;
 * - an epic with children in a project with a repo (WEBU-71): a strand at the epic that holds its branch and its PR,
 *   and for its first open child (in order of rank) a strand of the child on a branch from the branch of the epic, its
 *   PR into it; an epic strand of before its children are through goes on with its next child (another bot takes it);
 * - a child of an epic in a project with a repo: always a strand of its own into the branch of the epic, also when it
 *   is assigned alone; without the epic strand it is made first. A strand the child had of its own before (on the base
 *   of the project) ends;
 * - a child of an epic the bot works through by rule A (a strand of before WEBU-71, or a project without a repo): the
 *   child joins the strand of the epic, its task comes when the strand is free;
 * - an epic without a repo: a strand at the epic, a task for its first open child that nobody or the bot has (in order
 *   of rank); an epic without children is a task of its own.
 * Nothing when the bot is no agent in the project (the assignment stays a plain one) or the item went to someone else
 * meanwhile. Locks the item, then the runs of the strand, then the strand (as every action of the flow, A592).
 */
final class StartTask
{
    use AsAction;

    public function handle(Actor $actor, WorkItem $item, User $bot, ?string $triggerId = null): ?AgentRun
    {
        return DB::transaction(function () use ($actor, $item, $bot, $triggerId): ?AgentRun {
            $locked = ItemLock::take($item);
            if ($locked->assignee_id !== $bot->id || $locked->archived_at !== null || AgentFlow::refusal($bot, $locked->project) !== null) {
                return null;
            }

            $thread = AgentFlow::threadAt($locked->id);
            $repo = AgentFlow::repositoryOf($locked->project_id);
            $parent = $locked->parent_id === null || $locked->type->is_epic ? null : WorkItem::query()->find($locked->parent_id);
            $epic = $parent === null ? null : AgentFlow::threadAt($parent->id);
            // the branch of the epic takes its children (WEBU-71), not a strand of before at a rule A epic
            $onEpicBranch = $parent !== null && $repo !== null && ($epic === null || $epic->per_child);

            // a strand the child had of its own before WEBU-71 (on the base of the project) ends: a child goes on the branch of its epic
            if ($thread !== null && $onEpicBranch && $thread->parent_thread_id === null) {
                self::retire($actor, $thread);
                $thread = null;
            }

            if ($thread === null && ! AgentFlow::readyToBegin($locked)) {
                return null; // in the backlog the item waits for Todo (A772)
            }
            if ($thread === null && AgentFlow::blockers($locked) !== []) {
                return null; // it waits until its blockers are done (WEBU-51)
            }

            if ($thread !== null) {
                // the runs of the strand, then the strand (A592)
                [, $thread] = AgentFlow::lockStrand($thread);
            }

            // the strand of an epic on its own branch before its children are through: its next child (another bot takes it over)
            if ($thread !== null && $thread->per_child && $thread->ready_requested_at === null) {
                $thread->forceFill(['bot_id' => $bot->id, 'status' => AgentThread::OPEN, 'pause_reason' => null])->save();

                return self::nextOfEpic($actor, $thread, $locked, $bot, $triggerId);
            }

            if ($thread !== null && $thread->bot_id === $bot->id) {
                return StartCorrection::run($actor, $thread, 'comments', AgentFlow::commentsSince($thread, $locked), null, true);
            }

            if ($thread !== null) {
                PauseThread::run($actor, $thread, 'reassigned');
            }

            if ($onEpicBranch) {
                return self::childStrand($actor, self::epicStrand($bot, $parent, $repo), $locked, $bot, $triggerId);
            }

            if ($epic !== null && $epic->bot_id === $bot->id) {
                [$runs, $epic] = AgentFlow::lockStrand($epic);
                if ($epic->status === AgentThread::OPEN) {
                    return $runs->isEmpty() && AgentFlow::readyToBegin($locked) && AgentFlow::blockers($locked) === [] ? self::enqueue($actor, $bot, $epic, $locked, $triggerId) : null;
                }
            }

            $hasChildren = $locked->type->is_epic && WorkItem::query()->where('parent_id', $locked->id)->exists();
            $thread = AgentThread::query()->create([
                'bot_id' => $bot->id, 'project_id' => $locked->project_id, 'work_item_id' => $locked->id, 'status' => AgentThread::OPEN,
                'repository_github_id' => $repo?->repository->github_id, 'base_branch' => $repo?->base_branch,
                'branch' => AgentThread::freshBranchFor($locked), 'corrections' => 0, 'conflicts' => 0, 'per_child' => $hasChildren && $repo !== null,
            ]);

            if ($thread->per_child) {
                return self::nextOfEpic($actor, $thread, $locked, $bot, $triggerId);
            }

            $first = $hasChildren ? self::nextChild($thread, $locked, $bot) : $locked;

            return $first === null ? null : self::enqueue($actor, $bot, $thread, $first, $triggerId);
        }, 3);
    }

    /**
     * The next child of an epic the agent works on (rule A): open (not Completed or Canceled), not archived, nobody's or
     * the bot's, neither done in this strand nor with a task of it that waits or runs (two who start the next child at
     * once start it once); in order of rank.
     */
    public static function nextChild(AgentThread $thread, WorkItem $epic, User $bot): ?WorkItem
    {
        return self::candidates($thread, $epic, $bot)
            ->when(self::readyStates($epic) !== null, fn ($query) => $query->whereIn('state_id', self::readyStates($epic)))
            ->orderBy('rank')->orderBy('id')->first();
    }

    /** Whether open children wait for Todo: the epic is not ready while some do (A772). */
    public static function waitsForReady(AgentThread $thread, WorkItem $epic, User $bot): bool
    {
        $ready = self::readyStates($epic);

        // only children still in Backlog or Unstarted wait for Todo; a child that is started or failed is not waited for
        return $ready !== null && self::candidates($thread, $epic, $bot)
            ->whereNotIn('state_id', $ready)
            ->whereHas('state', fn ($query) => $query->whereIn('category', [StateCategory::Backlog->value, StateCategory::Unstarted->value]))
            ->exists();
    }

    /** @return Builder<WorkItem> */
    private static function candidates(AgentThread $thread, WorkItem $epic, User $bot)
    {
        return self::open(WorkItem::query()->where('parent_id', $epic->id)->whereNull('archived_at'))
            ->where(fn ($query) => $query->whereNull('assignee_id')->orWhere('assignee_id', $bot->id))
            ->whereNotExists(fn ($done) => $done->selectRaw('1')->from('agent_runs')->where('agent_runs.thread_id', $thread->id)
                ->whereColumn('agent_runs.work_item_id', 'work_items.id')->where('agent_runs.type', RunType::Task->value)
                ->whereIn('agent_runs.status', [RunStatus::Succeeded->value, RunStatus::Queued->value, RunStatus::Waiting->value, RunStatus::Running->value, RunStatus::Canceling->value]));
    }

    /**
     * The states a child of the epic may begin from (`ready` and the correction state), null without the step `ready`.
     *
     * @return list<string>|null
     */
    private static function readyStates(WorkItem $epic): ?array
    {
        $steps = Workflow::query()->find($epic->project->workflow_id)?->agentStates();

        return $steps === null || $steps['ready'] === null ? null : array_values(array_filter([$steps['ready'], $steps['correction']]));
    }

    /**
     * The next child of an epic on its own branch (WEBU-71): none while a child strand of it is open (one child at a
     * time), else the first open child (in order of rank) that nobody or the bot has, is not blocked, may begin and
     * has no strand: a strand of its own into the branch of the epic, and its task.
     */
    public static function nextOfEpic(Actor $actor, AgentThread $epicThread, WorkItem $epic, User $bot, ?string $triggerId): ?AgentRun
    {
        if (AgentThread::query()->where('parent_thread_id', $epicThread->id)->where('status', AgentThread::OPEN)->exists()) {
            return null;
        }

        $child = self::nextCandidate($epic, $bot);

        return $child === null ? null : self::childStrand($actor, $epicThread, ItemLock::take($child), $bot, $triggerId);
    }

    /** The child of an epic on its own branch that would begin next (nextOfEpic), read without a lock. */
    public static function nextCandidate(WorkItem $epic, User $bot): ?WorkItem
    {
        return self::childCandidates($epic, $bot)
            ->when(self::readyStates($epic) !== null, fn ($query) => $query->whereIn('state_id', self::readyStates($epic)))
            ->orderBy('rank')->orderBy('id')->first();
    }

    /**
     * The open children of an epic on its own branch that wait for a strand: nobody's or the bot's, not blocked, without
     * a strand that is open or paused.
     *
     * @return Builder<WorkItem>
     */
    public static function childCandidates(WorkItem $epic, User $bot)
    {
        return self::open(WorkItem::query()->where('parent_id', $epic->id)->whereNull('archived_at'))
            ->where(fn ($query) => $query->whereNull('assignee_id')->orWhere('assignee_id', $bot->id))
            ->whereNotExists(fn ($strand) => $strand->selectRaw('1')->from('agent_threads')->whereColumn('agent_threads.work_item_id', 'work_items.id')
                ->whereIn('agent_threads.status', [AgentThread::OPEN, AgentThread::PAUSED]));
    }

    /**
     * The strand of an epic on its own branch (WEBU-71): the open or paused one, else a new one from the base of the
     * project for the bot. The epic row is locked: two children that start at once make one.
     */
    private static function epicStrand(User $bot, WorkItem $epic, ProjectRepository $repo): AgentThread
    {
        WorkItem::query()->lockForUpdate()->findOrFail($epic->id);
        $thread = AgentFlow::threadAt($epic->id);
        if ($thread !== null) {
            return AgentThread::query()->lockForUpdate()->findOrFail($thread->id);
        }

        return AgentThread::query()->create([
            'bot_id' => $bot->id, 'project_id' => $epic->project_id, 'work_item_id' => $epic->id, 'status' => AgentThread::OPEN,
            'repository_github_id' => $repo->repository->github_id, 'base_branch' => $repo->base_branch,
            'branch' => AgentThread::freshBranchFor($epic), 'corrections' => 0, 'conflicts' => 0, 'per_child' => true,
        ]);
    }

    /** A strand of a child on a branch from the branch of its epic, its PR into it (WEBU-71), and its task. */
    private static function childStrand(Actor $actor, AgentThread $epicThread, WorkItem $child, User $bot, ?string $triggerId): ?AgentRun
    {
        $thread = AgentThread::query()->create([
            'bot_id' => $bot->id, 'project_id' => $child->project_id, 'work_item_id' => $child->id, 'status' => AgentThread::OPEN,
            'repository_github_id' => $epicThread->repository_github_id, 'base_branch' => $epicThread->branch,
            'branch' => AgentThread::freshBranchFor($child), 'corrections' => 0, 'conflicts' => 0, 'per_child' => false,
            'parent_thread_id' => $epicThread->id,
        ]);

        return self::enqueue($actor, $bot, $thread, $child, $triggerId);
    }

    /** Ends a strand the child had of its own before WEBU-71: what of it waits or runs stops, the item stays as it is. */
    private static function retire(Actor $actor, AgentThread $thread): void
    {
        [$runs, $locked] = AgentFlow::lockStrand($thread);
        foreach ($runs as $run) {
            CancelRun::stop($actor, $run);
        }
        $locked->forceFill(['status' => AgentThread::CLOSED])->save();
    }

    /**
     * @param  Builder<WorkItem>  $query
     * @return Builder<WorkItem>
     */
    private static function open(Builder $query): Builder
    {
        return $query->whereHas('state', fn ($state) => $state->whereNotIn('category', [StateCategory::Completed->value, StateCategory::Canceled->value]))
            ->whereNotExists(fn ($blocked) => $blocked->selectRaw('1')->from('work_item_relations as blocks')
                ->join('relation_types as block_types', 'block_types.id', '=', 'blocks.type_id')
                ->join('work_items as blocker', 'blocker.id', '=', 'blocks.source_id')
                ->join('workflow_states as blocker_states', 'blocker_states.id', '=', 'blocker.state_id')
                ->where('block_types.built_in', 'blocks')->whereColumn('blocks.target_id', 'work_items.id')
                ->whereNotIn('blocker_states.category', [StateCategory::Completed->value, StateCategory::Canceled->value]));
    }

    /** Queues the task of an item at a strand; an agent switched off meanwhile queues nothing. */
    public static function enqueue(Actor $actor, User $bot, AgentThread $thread, WorkItem $item, ?string $triggerId): ?AgentRun
    {
        try {
            return EnqueueRun::run($actor, $bot, $item->project, $item, RunType::Task->value, $thread, ['trigger_event_id' => $triggerId]);
        } catch (Problem) {
            return null;
        }
    }
}
