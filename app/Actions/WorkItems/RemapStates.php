<?php

namespace App\Actions\WorkItems;

use App\Domain\WorkItems\MoveStamps;
use App\Domain\WorkItems\ResolutionRule;
use App\Events\EventRecorder;
use App\Events\EventType;
use App\Models\Project;
use App\Models\Resolution;
use App\Models\WorkflowState;
use App\Models\WorkItem;
use App\Support\Actor;
use App\Support\StateSnapshot;
use Illuminate\Database\Eloquent\Collection;
use Illuminate\Support\Facades\DB;
use Lorisleiva\Actions\Concerns\AsAction;

/**
 * Moves the work items of projects out of states that go away (spec 4.5): a project switches its workflow
 * (AssignWorkflow, `workflow_changed`) or its workflow loses states (SaveWorkflow, `state_removed`). Every item of the
 * projects whose state is a key of the mapping (old state → new state) gets the new state, archived items as well (they
 * stay archived, even in an open state); the workflow is not asked, the state the item was in goes. The resolution and
 * the stamps follow like a move (ResolutionRule without a choice, MoveStamps), and each item records a
 * `work_item.state_changed` with the reason in `meta.reason` and both states in `meta.states` (StateSnapshot: the
 * state that goes keeps its name in the history). Items of a project being deleted (`deleting_at`, SaveWorkflow names
 * them: their foreign key holds the state) are moved as well, but record no event: the purge takes them, and the history
 * of an item nobody can open again is noise.
 *
 * No right and no lock of its own: the callers have checked theirs and hold the organization `for update` (P1, P2), so
 * every change of an item waits until the items are moved. Runs synchronously in the transaction of the caller (P2),
 * the items in blocks of 500.
 */
final class RemapStates
{
    use AsAction;

    public const WORKFLOW_CHANGED = 'workflow_changed';

    public const STATE_REMOVED = 'state_removed';

    /** How many items are read and moved at a time. */
    public const BLOCK = 500;

    /**
     * @param  list<string>  $projectIds
     * @param  array<string, string>  $mapping  state ULID → state ULID
     * @return int how many items were moved
     */
    public function handle(Actor $actor, array $projectIds, array $mapping, string $reason): int
    {
        $actor = new Actor($actor->user, $actor->via, $reason, $actor->token);

        return DB::transaction(function () use ($actor, $projectIds, $mapping): int {
            $states = WorkflowState::query()->whereKey([...array_keys($mapping), ...array_values($mapping)])->get()->keyBy('id')->all();
            $projects = Project::query()->whereKey($projectIds)->get()->keyBy('id')->all();
            $choices = TransitionWorkItem::choices(Resolution::query()->get());
            $now = (new WorkItem)->freshTimestamp();
            $moved = 0;

            WorkItem::query()->whereIn('project_id', $projectIds)->whereIn('state_id', array_keys($mapping))
                ->chunkById(self::BLOCK, function (Collection $items) use ($actor, $mapping, $states, $projects, $choices, $now, &$moved): void {
                    foreach ($items as $item) {
                        /** @var WorkItem $item */
                        $from = $states[$item->state_id];
                        $to = $states[$mapping[$item->state_id]];
                        $resolution = ResolutionRule::after($from->category, $to->category, $item->resolution_id, null, $choices);
                        $stamps = MoveStamps::after($from->category, $to->category, $item->started_at?->toDateTimeImmutable(), $item->closed_at?->toDateTimeImmutable(), $now->toDateTimeImmutable());

                        $changes = ['state_id' => ['old' => $from->id, 'new' => $to->id]];
                        if ($resolution !== $item->resolution_id) {
                            $changes['resolution_id'] = ['old' => $item->resolution_id, 'new' => $resolution];
                        }

                        $item->state_id = $to->id;
                        $item->resolution_id = $resolution;
                        $item->setAttribute('started_at', $stamps['started_at']);
                        $item->setAttribute('closed_at', $stamps['closed_at']);
                        $item->updated_at = $now;
                        $item->save();

                        // a project being deleted goes with its items (PurgeProject): an event would outlive them
                        $project = $projects[$item->project_id];
                        if ($project->deleting_at === null) {
                            EventRecorder::record(EventType::WorkItemStateChanged, $actor, $item, $project, $changes, ['states' => StateSnapshot::of($from, $to)]);
                        }
                        $moved++;
                    }
                });

            return $moved;
        });
    }
}
