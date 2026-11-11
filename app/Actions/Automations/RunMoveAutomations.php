<?php

namespace App\Actions\Automations;

use App\Access\Assignable;
use App\Actions\WorkItems\TransitionWorkItem;
use App\Actions\WorkItems\UpdateWorkItem;
use App\Domain\Automations\AssignOnStartRule;
use App\Domain\Automations\AutomationKey;
use App\Domain\Automations\CloseParentRule;
use App\Events\EventRecorder;
use App\Events\EventType;
use App\Models\Workflow;
use App\Models\WorkflowState;
use App\Models\WorkItem;
use App\Support\Actor;
use App\Support\ProjectAutomations;
use Illuminate\Support\Facades\DB;
use Lorisleiva\Actions\Concerns\AsAction;

/**
 * The automations of a move (spec 4.13, A341, A342), after the move of an item into another state and in its
 * transaction (TransitionWorkItem::move(), also for a move of UpdateWorkItem, BulkUpdateWorkItems and CreateWorkItem in
 * another state, K26; never for RemapStates, which moves nothing by hand):
 *
 * - `assign_on_start`: a person (never a bot, never a template run) who moves an item nobody has from a state that is
 *   not started into a started one (and does not name the assignee in the same change, even as nobody) and can take
 *   work in the project becomes its assignee and watches it like any new assignee; `work_item.assigned` of the
 *   default bot on behalf of the person.
 * - `close_parent`: a child that closes moves its parent into the first Completed state of the workflow it may move to,
 *   when every child is closed and one of them is completed (CloseParentRule), on behalf of the person whose move it
 *   was (or of the person the acting automation acted for), quiet when that move was (A357); an archived parent stays. The parent is locked after the
 *   child (`for update`), then its children with a shared lock: two people closing the last two children at once wait
 *   for each other (or deadlock, and the transaction of the move runs again), and the second one sees the first child
 *   closed. Its move runs the automations again, up to CloseParentRule::MAX_CHAIN levels up.
 *
 * A system action without rights or locks of its own (the caller holds the child); a savepoint of the caller's
 * transaction (K6).
 */
final class RunMoveAutomations
{
    use AsAction;

    /** `$assigneeNamed`: the change that moved the item named its assignee (even as nobody); that one wins (T11-M1). */
    public function handle(Actor $actor, WorkItem $locked, WorkflowState $from, WorkflowState $to, int $chain = 0, bool $assigneeNamed = false): void
    {
        if ($from->id === $to->id) {
            return;
        }

        DB::transaction(function () use ($actor, $locked, $from, $to, $chain, $assigneeNamed): void {
            if (! $assigneeNamed) {
                self::assignOnStart($actor, $locked, $from, $to);
            }
            self::closeParent($actor, $locked, $to, $chain);
        });
    }

    private static function assignOnStart(Actor $actor, WorkItem $locked, WorkflowState $from, WorkflowState $to): void
    {
        $person = $actor->user;
        if (! AssignOnStartRule::applies($person->isPerson(), $locked->assignee_id, $from->category, $to->category)
            || ProjectAutomations::enabled($locked->project_id, AutomationKey::AssignOnStart) === null
            || ! Assignable::check($person, $locked->project)) {
            return;
        }

        $locked->assignee_id = $person->id;
        $locked->updated_at = $locked->freshTimestamp();
        $locked->save();

        UpdateWorkItem::watch($locked, $person->id);
        EventRecorder::record(EventType::WorkItemAssigned, Actor::automation('assign_on_start')->onBehalfOf($person), $locked, $locked->project, [
            'assignee_id' => ['old' => null, 'new' => $person->id],
        ]);
    }

    private static function closeParent(Actor $actor, WorkItem $locked, WorkflowState $to, int $chain): void
    {
        if (! $to->category->isClosed() || $locked->parent_id === null || $chain >= CloseParentRule::MAX_CHAIN
            || ProjectAutomations::enabled($locked->project_id, AutomationKey::CloseParent) === null) {
            return;
        }

        // the parent lives in the project of its child (spec 4.8), so its automation is the one just read; it is there
        // (a deletion of it locks it, then waits for this child)
        $parent = WorkItem::query()->whereKey($locked->parent_id)->lockForUpdate()->firstOrFail();
        if ($parent->archived_at !== null) {
            return;
        }
        $parent->setRelation('project', $locked->project);

        $children = WorkItem::query()->where('parent_id', $parent->id)->orderBy('id')->sharedLock()->get();
        $workflow = Workflow::query()->with(['states', 'transitions'])->findOrFail($locked->project->workflow_id);
        $category = fn (string $stateId) => $workflow->states->firstOrFail(fn (WorkflowState $state) => $state->id === $stateId)->category;

        if (! CloseParentRule::closes(array_values($children->map(fn (WorkItem $child) => $category($child->state_id))->all()), $category($parent->state_id))) {
            return;
        }

        $states = array_values($workflow->states->map(fn (WorkflowState $state) => ['id' => $state->id, 'category' => $state->category])->all());
        $target = CloseParentRule::target($states, $parent->state_id, $workflow->graph());
        if ($target === null) {
            return;
        }

        TransitionWorkItem::move(Actor::automationFor('close_parent', $actor), $parent, $target, null, chain: $chain + 1);
    }
}
