<?php

namespace App\Domain\WorkItems;

use App\Domain\Workflow\StateCategory;
use DateTimeImmutable;

/**
 * When an item was started and closed (spec 4.4), after a move between states.
 */
final class MoveStamps
{
    /**
     * - `started_at`: set the first time the item enters Started, never changed after.
     * - `closed_at`: cleared on a move into an open category; `$now` on the way into Completed or Canceled from an open
     *   category or from the other closed one; unchanged on moves within a closed category.
     *
     * @return array{started_at: ?DateTimeImmutable, closed_at: ?DateTimeImmutable}
     */
    public static function after(StateCategory $from, StateCategory $to, ?DateTimeImmutable $startedAt, ?DateTimeImmutable $closedAt, DateTimeImmutable $now): array
    {
        if ($to === StateCategory::Started && $startedAt === null) {
            $startedAt = $now;
        }

        if (! $to->isClosed()) {
            $closedAt = null;
        } elseif ($from !== $to) {
            // into a closed category from an open one or from the other closed one
            $closedAt = $now;
        }

        return ['started_at' => $startedAt, 'closed_at' => $closedAt];
    }
}
