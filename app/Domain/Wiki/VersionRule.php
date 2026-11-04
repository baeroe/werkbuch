<?php

namespace App\Domain\Wiki;

/**
 * When the stored state of a page is kept as a version before a save replaces it (spec 4.15): before a foreign
 * version is overwritten, after ten minutes without an edit, and when the writer asks for it ("Meine Fassung
 * übernehmen", A307). Times are Unix seconds: no Carbon in the domain.
 */
final class VersionRule
{
    /** The pause after which the state that rested is kept. */
    public const PAUSE_SECONDS = 600;

    public static function keepBefore(string $writerId, string $lastEditorId, int $lastSavedAt, int $now, bool $asked): bool
    {
        return $asked || $writerId !== $lastEditorId || $now - $lastSavedAt >= self::PAUSE_SECONDS;
    }
}
