<?php

namespace App\Domain\WorkItems;

use App\Domain\Workflow\StateCategory;

/**
 * Resolutions (spec 4.7): the reason an item was closed. Set on the way into Completed or Canceled, cleared on the
 * way back out.
 */
final class ResolutionRule
{
    /**
     * The resolution an item has after a transition.
     * - Into an open category: none.
     * - Into a closed category: the chosen one, if it exists and is not archived; otherwise the one the item already has
     *   when it stays in the same category; otherwise the default of the category with the lowest position (none when
     *   there is no default that is not archived).
     *
     * @param  list<ResolutionChoice>  $resolutions
     */
    public static function after(StateCategory $from, StateCategory $to, ?string $current, ?string $chosen, array $resolutions): ?string
    {
        if (! $to->isClosed()) {
            return null;
        }

        foreach ($resolutions as $resolution) {
            if ($chosen !== null && $resolution->id === $chosen && ! $resolution->archived) {
                return $chosen;
            }
        }

        if ($from === $to && $current !== null) {
            return $current;
        }

        $defaults = array_values(array_filter(
            $resolutions,
            fn (ResolutionChoice $resolution) => $resolution->defaultFor === $to && ! $resolution->archived,
        ));
        usort($defaults, fn (ResolutionChoice $a, ResolutionChoice $b) => $a->position <=> $b->position);

        return $defaults[0]->id ?? null;
    }
}
