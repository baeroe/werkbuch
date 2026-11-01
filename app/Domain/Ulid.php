<?php

namespace App\Domain;

/**
 * The form of a ULID in the domain rules: 26 characters of Crockford's alphabet, the first one 0-7, as `Str::isUlid`
 * and the `ulid` rule take it (A96). The pattern is for ULIDs in small letters, as the app stores them.
 */
final class Ulid
{
    public const PATTERN = '/^[0-7][0-9a-hjkmnp-tv-z]{25}\z/';

    /** Whether the text is a ULID in small or capital letters. */
    public static function is(string $value): bool
    {
        return preg_match(self::PATTERN, strtolower($value)) === 1;
    }
}
