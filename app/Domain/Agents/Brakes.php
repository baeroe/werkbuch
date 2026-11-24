<?php

namespace App\Domain\Agents;

/**
 * The brakes of a strand (spec 7.2): at most so many corrections and conflicts (set per project); conflicts do not
 * count against corrections. A strand at its brake pauses.
 */
final class Brakes
{
    public const MAX = 10;

    /** Whether one more run of the kind may start at a strand that had so many. */
    public static function allows(RunType $type, int $corrections, int $conflicts, int $maxCorrections, int $maxConflicts): bool
    {
        return match ($type) {
            RunType::Correction => $corrections < $maxCorrections,
            RunType::Conflict => $conflicts < $maxConflicts,
            default => true,
        };
    }
}
