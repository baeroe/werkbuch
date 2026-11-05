<?php

namespace App\Domain\Automations;

use App\Domain\Workflow\StateCategory;
use App\Domain\Workflow\TransitionGraph;

/**
 * "Close parent": when the last child of an open parent closes and at least one of them is completed, the parent
 * moves into a completed state of its workflow.
 */
final class CloseParentRule
{
    /** How many levels upwards a chain of closing parents may reach. */
    public const MAX_CHAIN = 5;

    /**
     * Whether the parent closes: it is open, it has children, all of them are closed and at least one is completed.
     *
     * @param  list<StateCategory>  $children
     */
    public static function closes(array $children, StateCategory $parent): bool
    {
        if ($parent->isClosed() || $children === []) {
            return false;
        }

        $completed = false;
        foreach ($children as $child) {
            if (! $child->isClosed()) {
                return false;
            }
            $completed = $completed || $child === StateCategory::Completed;
        }

        return $completed;
    }

    /**
     * The first completed state in the order of the workflow that the parent may move to from where it is, or null.
     *
     * @param  list<array{id: string, category: StateCategory}>  $statesInOrder
     */
    public static function target(array $statesInOrder, string $fromId, TransitionGraph $graph): ?string
    {
        foreach ($statesInOrder as $state) {
            if ($state['category'] === StateCategory::Completed && $state['id'] !== $fromId && $graph->canTransition($fromId, $state['id'])) {
                return $state['id'];
            }
        }

        return null;
    }
}
