<?php

namespace App\Domain\Accounts;

/**
 * The handle of an account (@mention, URLs): a-z, 0-9 and "-", 3 to 32 characters. Uniqueness is the database's job;
 * suggest() only walks to a free one.
 */
final class Handle
{
    public const PATTERN = '/^[a-z0-9-]{3,32}$/';

    public const MIN_LENGTH = 3;

    public const MAX_LENGTH = 32;

    private const UMLAUTS = ['ä' => 'ae', 'ö' => 'oe', 'ü' => 'ue', 'ß' => 'ss'];

    public static function isValid(string $handle): bool
    {
        return preg_match(self::PATTERN, $handle) === 1;
    }

    /**
     * A valid, free handle for a name or an email address (the part before "@" counts).
     *
     * @param  callable(string): bool  $taken
     */
    public static function suggest(string $source, callable $taken): string
    {
        $stem = self::stem($source);

        if ($stem === '') {
            $stem = 'user';
        } elseif (strlen($stem) < self::MIN_LENGTH) {
            $stem .= '-user';
        }

        $candidate = $stem;

        for ($number = 2; $taken($candidate); $number++) {
            $suffix = '-'.$number;
            $candidate = rtrim(substr($stem, 0, self::MAX_LENGTH - strlen($suffix)), '-').$suffix;
        }

        return $candidate;
    }

    private static function stem(string $source): string
    {
        $local = strstr($source, '@', true);
        $lower = strtr(mb_strtolower($local === false ? $source : $local), self::UMLAUTS);
        $slug = trim((string) preg_replace('/[^a-z0-9]+/', '-', $lower), '-');

        return rtrim(substr($slug, 0, self::MAX_LENGTH), '-');
    }
}
