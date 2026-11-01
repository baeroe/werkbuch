<?php

namespace App\Support;

/**
 * The ids a client gives the rows it sends along with a catalog entry (the states of a workflow, the options of a
 * property; P3). A row sent with an id is named by it, one without is named `new:<index>` (no id of a client starts
 * with that). Only the rows of the entry itself keep their ULID; every other id is a new row, whose ULID is known once
 * it is written. Writes nothing.
 */
final class ClientKeys
{
    /** The start of the key of a row sent without an id; sent ids never start with it. */
    public const PREFIX = 'new:';

    /** The longest id a client may give a row. */
    public const MAX = 64;

    /**
     * The key of a row: its id, `new:<index>` without one (`$index` counts the rows in the order they were sent).
     *
     * @param  array{id?: ?string}  $row
     */
    public static function keyOf(array $row, int $index): string
    {
        return $row['id'] ?? self::PREFIX.$index;
    }

    /**
     * The ULID a key stands for: itself when it is one of the entry's own rows (`$keys`), else the ULID written for it
     * (`$ids`, key → ULID); `null` for a row that is no row of the entry and not written yet.
     *
     * @param  array<array-key, int|string>  $keys  the ULIDs of the rows the entry has
     * @param  array<string, string>  $ids  the ULIDs written for the keys of the input
     */
    public static function resolve(array $keys, array $ids, string $key): ?string
    {
        return in_array($key, $keys, true) ? $key : ($ids[$key] ?? null);
    }
}
