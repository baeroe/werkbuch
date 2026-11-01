<?php

namespace App\Support;

use App\Models\WorkflowState;

/**
 * The two states of a move, frozen into the `meta.states` of a `work_item.state_changed` (TransitionWorkItem::move,
 * RemapStates): id, name and category as they were at that moment. `changes.state_id` keeps the ids alone; the history
 * names the states from here, so a state that is renamed or removed later (SaveWorkflow, a workflow deleted after a
 * switch) still reads as it did.
 */
final class StateSnapshot
{
    /**
     * @return array{old: array{id: string, name: string, category: string}, new: array{id: string, name: string, category: string}}
     */
    public static function of(WorkflowState $from, WorkflowState $to): array
    {
        return ['old' => self::state($from), 'new' => self::state($to)];
    }

    /**
     * @return array{id: string, name: string, category: string}
     */
    private static function state(WorkflowState $state): array
    {
        return ['id' => $state->id, 'name' => $state->name, 'category' => $state->category->value];
    }
}
