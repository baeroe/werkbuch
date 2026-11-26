<?php

namespace App\Actions\Agents;

use App\Actions\AgentRuns\EnqueueRun;
use App\Domain\Agents\RunStatus;
use App\Domain\Agents\RunType;
use App\Domain\Workflow\StateCategory;
use App\Exceptions\Problem;
use App\Models\AgentRun;
use App\Models\AgentThread;
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
 * - a child of an epic the bot works through (rule A): the child joins the strand of the epic, its task comes when the
 *   strand is free;
 * - an epic: a strand at the epic on the branch of the epic, a task for its first open child that nobody or the bot
 *   has (in order of rank); an epic without children is a task of its own.
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
            if ($thread === null && ! AgentFlow::readyToBegin($locked)) {
                return null; // in the backlog the item waits for Todo (A772)
            }

            if ($thread !== null) {
                // the runs of the strand, then the strand (A592)
                [, $thread] = AgentFlow::lockStrand($thread);
            }

            if ($thread !== null && $thread->bot_id === $bot->id) {
                return StartCorrection::run($actor, $thread, 'comments', AgentFlow::commentsSince($thread, $locked), null, true);
            }

            if ($thread !== null) {
                PauseThread::run($actor, $thread, 'reassigned');
            }

            $epic = $locked->parent_id === null || $locked->type->is_epic ? null : AgentFlow::threadAt($locked->parent_id);
            if ($epic !== null && $epic->bot_id === $bot->id) {
                [$runs, $epic] = AgentFlow::lockStrand($epic);
                if ($epic->status === AgentThread::OPEN) {
                    return $runs->isEmpty() && AgentFlow::readyToBegin($locked) ? self::enqueue($actor, $bot, $epic, $locked, $triggerId) : null;
                }
            }

            $repo = AgentFlow::repositoryOf($locked->project_id);
            $thread = AgentThread::query()->create([
                'bot_id' => $bot->id, 'project_id' => $locked->project_id, 'work_item_id' => $locked->id, 'status' => AgentThread::OPEN,
                'repository_github_id' => $repo?->repository->github_id, 'base_branch' => $repo?->base_branch,
                'branch' => AgentThread::branchFor($locked), 'corrections' => 0, 'conflicts' => 0,
            ]);

            $hasChildren = $locked->type->is_epic && WorkItem::query()->where('parent_id', $locked->id)->exists();
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
        return self::readyStates($epic) !== null && self::candidates($thread, $epic, $bot)->exists();
    }

    /** @return Builder<WorkItem> */
    private static function candidates(AgentThread $thread, WorkItem $epic, User $bot)
    {
        return WorkItem::query()->where('parent_id', $epic->id)->whereNull('archived_at')
            ->where(fn ($query) => $query->whereNull('assignee_id')->orWhere('assignee_id', $bot->id))
            ->whereHas('state', fn ($query) => $query->whereNotIn('category', [StateCategory::Completed->value, StateCategory::Canceled->value]))
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
