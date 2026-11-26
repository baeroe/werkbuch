<?php

namespace App\Actions\Agents;

use App\Actions\AgentRuns\CancelRun;
use App\Domain\Agents\RunStatus;
use App\Domain\Agents\RunType;
use App\Domain\Workflow\StateCategory;
use App\Events\EventType;
use App\Models\AgentRun;
use App\Models\AgentThread;
use App\Models\Comment;
use App\Models\Event;
use App\Models\User;
use App\Models\Workflow;
use App\Models\WorkflowState;
use App\Models\WorkItem;
use App\Support\Actor;
use App\Support\AgentFlow;
use App\Support\ItemLock;
use Illuminate\Support\Facades\DB;
use Lorisleiva\Actions\Concerns\AsAction;

/**
 * The triggers of the flow of the agents among the events of werkbuch (spec 7.1, 7.2), for AgentConsumer:
 * - `bot.assigned`: a task (StartTask), when a person or werkbuch (a template) assigned;
 * - `bot.mentioned` from a new comment of a person: a comment run (never from a description, a value, an edit);
 * - `work_item.assigned` of a person to someone else than the bot of the strand: the strand pauses; a child of an
 *   epic the agent works through given to someone else ends its task, the epic goes on (A599);
 * - `work_item.state_changed` of a person to Backlog or Unstarted at an item whose strand has a PR: a correction; to
 *   Canceled the strand pauses (A595); a child of an epic the agent works through that a person closed ends its task
 *   and may make the epic ready;
 * - `agent_run.started`, `agent_run.finished`: the moves and what comes of the result;
 * - `project.merge_guard_confirmed`: the work the guard held back.
 * Never a trigger: what the flow does itself (the actor `agent`), what a bot does through its token (spec 7.1, A563).
 * Answers what it did (for tests and the log).
 */
final class FollowEvent
{
    use AsAction;

    public function handle(Actor $actor, Event $event): string
    {
        return match ($event->type) {
            EventType::AgentRunStarted => self::ofRun($event, fn (AgentRun $run) => HandleRunStarted::run($actor, $run)) ?? 'started',
            EventType::AgentRunFinished => self::ofRun($event, fn (AgentRun $run) => HandleRunResult::run($actor, $run)) ?? 'finished',
            EventType::ProjectMergeGuardConfirmed => (string) ResumeAfterGuard::run($actor, array_values((array) ($event->meta['thread_ids'] ?? []))),
            default => self::byPeople($actor, $event),
        };
    }

    private static function byPeople(Actor $actor, Event $event): string
    {
        $by = User::query()->find($event->actor_id);
        $item = $event->subject_type === 'work_item' ? WorkItem::query()->find($event->subject_id) : null;
        $template = ($event->meta['via'] ?? null) === Actor::VIA_TEMPLATE;
        if ($by === null || $item === null || ($event->meta['reason'] ?? null) === Actor::AGENT || ($by->isBot() && ! ($template && $event->type === EventType::BotAssigned))) {
            return 'ignored';
        }

        $bot = is_string($event->meta['bot_id'] ?? null) ? User::query()->find($event->meta['bot_id']) : null;

        return match ($event->type) {
            EventType::BotAssigned => self::assigned($actor, $event, $item, $bot),
            EventType::BotMentioned => self::mentioned($actor, $event, $item, $bot),
            EventType::WorkItemAssigned => self::reassigned($actor, $event, $item),
            EventType::WorkItemStateChanged => self::setBack($actor, $event, $item),
            default => 'ignored',
        };
    }

    private static function assigned(Actor $actor, Event $event, WorkItem $item, ?User $bot): string
    {
        return $bot !== null && StartTask::run($actor, $item, $bot, $event->id) !== null ? 'task' : 'ignored';
    }

    private static function mentioned(Actor $actor, Event $event, WorkItem $item, ?User $bot): string
    {
        $comment = ($event->meta['source'] ?? null) === 'comment' && ! isset($event->meta['edited']) ? Comment::query()->find($event->meta['comment_id'] ?? null) : null;

        return $bot !== null && $comment !== null && StartComment::run($actor, $item, $bot, $comment) !== null ? 'comment' : 'ignored';
    }

    private static function reassigned(Actor $actor, Event $event, WorkItem $item): string
    {
        $thread = AgentThread::query()->where('work_item_id', $item->id)->where('status', AgentThread::OPEN)->orderByDesc('id')->first();
        $new = $event->changes['assignee_id']['new'] ?? null;
        $epic = self::epicOf($item);

        // a child of an epic the agent works through, given to someone else: its task ends, the epic goes on (A599)
        if ($thread === null && $epic !== null && $new !== $epic->bot_id) {
            return self::leaveChild($actor, $item, $epic);
        }

        if ($thread === null || $new === $thread->bot_id) {
            return 'ignored';
        }

        PauseThread::run($actor, $thread, 'reassigned');

        return 'paused';
    }

    /** The open strand of the epic of an item, when its parent has one. */
    private static function epicOf(WorkItem $item): ?AgentThread
    {
        return $item->parent_id === null ? null : AgentThread::query()->where('work_item_id', $item->parent_id)->where('status', AgentThread::OPEN)->orderByDesc('id')->first();
    }

    /**
     * A child left the agent of its epic (a person took or closed it, A599): its task that waits or runs is canceled
     * (one on a runner ends with `canceled`, HandleRunResult goes on then); with nothing of the strand open the epic goes
     * on at once.
     */
    private static function leaveChild(Actor $actor, WorkItem $item, AgentThread $epic): string
    {
        $canceled = DB::transaction(function () use ($actor, $item, $epic): int {
            ItemLock::take($item);
            $runs = AgentFlow::openRuns($epic, RunType::Task)->where('work_item_id', $item->id);
            foreach ($runs->filter(fn (AgentRun $run) => $run->status !== RunStatus::Canceling) as $run) {
                CancelRun::stop($actor, $run);
            }

            return $runs->count();
        }, 3);

        return HandleRunResult::continueEpic($actor, $epic) ?? ($canceled > 0 ? 'canceled' : 'ignored');
    }

    private static function setBack(Actor $actor, Event $event, WorkItem $item): string
    {
        $new = $event->changes['state_id']['new'] ?? null;
        $to = is_string($new) ? WorkflowState::query()->find($new) : null;

        if ($to !== null && $to->category->isClosed()) {
            // a person canceled an item of an agent: its strand pauses, its PR merged later leaves it canceled (A595)
            $own = AgentThread::query()->where('work_item_id', $item->id)->where('status', AgentThread::OPEN)->orderByDesc('id')->first();
            if ($to->category === StateCategory::Canceled && $own !== null) {
                PauseThread::run($actor, $own, 'canceled');
            }

            $epic = self::epicOf($item);

            return $epic !== null ? self::leaveChild($actor, $item, $epic) : ($own !== null && $to->category === StateCategory::Canceled ? 'paused' : 'ignored');
        }

        $thread = AgentThread::query()->where('work_item_id', $item->id)->where('status', AgentThread::OPEN)->whereNotNull('pr_number')->orderByDesc('id')->first();
        if ($to !== null && $thread === null && self::isReady($item, $to)) {
            return self::begin($actor, $event, $item);
        }

        if ($to === null || $thread === null || $item->assignee_id !== $thread->bot_id || ! in_array($to->category, [StateCategory::Backlog, StateCategory::Unstarted], true)) {
            return 'ignored';
        }

        return StartCorrection::run($actor, $thread, 'comments', AgentFlow::commentsSince($thread, $item)) === null ? 'ignored' : 'correction';
    }

    /** Whether a state is the step `ready` of the workflow of the item (WEBU-44, A772). */
    private static function isReady(WorkItem $item, WorkflowState $to): bool
    {
        $steps = Workflow::query()->find($item->project->workflow_id)?->agentStates();

        return $steps !== null && $steps['ready'] !== null && in_array($to->id, [$steps['ready'], $steps['correction']], true);
    }

    /**
     * A person moved an item to Todo (`ready`) that has no PR yet: the bot it is assigned to begins it; a child of an
     * epic the agent works through is taken up by the epic (A772).
     */
    private static function begin(Actor $actor, Event $event, WorkItem $item): string
    {
        if (AgentFlow::threadAt($item->id) !== null) {
            return 'ignored';
        }

        $bot = $item->assignee_id === null ? null : User::query()->find($item->assignee_id);
        if ($bot !== null && $bot->isBot() && StartTask::run($actor, $item, $bot, $event->id) !== null) {
            return 'task';
        }

        $epic = self::epicOf($item);

        return $epic !== null && ($item->assignee_id === null || $item->assignee_id === $epic->bot_id) && HandleRunResult::continueEpic($actor, $epic) === 'next_child' ? 'task' : 'ignored';
    }

    /**
     * @param  callable(AgentRun): mixed  $then
     */
    private static function ofRun(Event $event, callable $then): ?string
    {
        $run = AgentRun::query()->find($event->subject_id);
        if ($run === null) {
            return 'ignored';
        }

        $answer = $then($run);

        return is_string($answer) ? $answer : null;
    }
}
