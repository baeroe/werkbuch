<?php

namespace App\Domain\WorkItems;

/**
 * Item keys (spec 4.4, 4.17): the project identifier and the number, `WEB-123`. The key is never stored; it is read
 * from what a person types or a link holds (P20).
 */
final class ItemKey
{
    /** 2-10 letters or digits starting with a letter, a dash, at most ten digits; the end of the text, not of a line. */
    public const PATTERN = '/^([A-Za-z][A-Za-z0-9]{1,9})-(\d{1,10})\z/';

    /** The largest number of the unsigned int column `work_items.number` (P28). */
    public const MAX_NUMBER = 4294967295;

    /**
     * Reads what a person typed as a key. Case and surrounding blanks do not matter; null when it is not a key.
     *
     * @return array{identifier: string, number: int}|null
     */
    public static function parse(string $input): ?array
    {
        if (preg_match(self::PATTERN, trim($input), $match) !== 1) {
            return null;
        }

        $number = (int) $match[2];
        if ($number < 1 || $number > self::MAX_NUMBER) {
            return null;
        }

        return ['identifier' => strtoupper($match[1]), 'number' => $number];
    }
}
