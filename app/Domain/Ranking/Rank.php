<?php

namespace App\Domain\Ranking;

use InvalidArgumentException;

/**
 * Manual order (spec 4.8, 13): every item carries a rank, a key that sorts between its neighbours, so a move only
 * changes the rank of the moved item. A port of fractional-indexing 4.0 (`generateKeyBetween`, `generateNKeysBetween`
 * with its default alphabets), giving the same keys as the clickdummy and the frontend. Ranks compare as bytes
 * (`strcmp`, the column's `ascii_bin`), never by letters: "Zz" sorts before "a0".
 *
 * Unlike the library, a rank is refused when it has a character outside the 62 digits, and neighbours in the wrong
 * order are refused instead of swapped. The checks of the library that the validation makes unreachable (trailing zeros
 * and order inside `midpoint`, the integer part inside `incrementInteger`/`decrementInteger`) are left out.
 */
final class Rank
{
    /** The digits of a rank, in byte order. */
    public const DIGITS = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';

    /** The heads of the integer part: A-Z for the negative lengths, a-z for the positive ones. */
    private const INT_DIGITS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';

    /** The smallest integer, which is no rank: nothing would fit before it. */
    private const SMALLEST_INTEGER = 'A00000000000000000000000000';

    /**
     * A rank that sorts strictly between two neighbours; `null` stands for "no neighbour": `between(null, null)` is the
     * first rank of an empty list, `between($last, null)` appends, `between(null, $first)` prepends.
     *
     * @throws InvalidArgumentException when a neighbour is no rank, both are the same or they are in the wrong order
     */
    public static function between(?string $before, ?string $after): string
    {
        if ($before !== null) {
            self::validate($before);
        }
        if ($after !== null) {
            self::validate($after);
        }
        if ($before !== null && $before === $after) {
            throw new InvalidArgumentException("Both neighbours have the rank \"{$before}\".");
        }
        if ($before !== null && $after !== null && strcmp($before, $after) > 0) {
            throw new InvalidArgumentException("The rank \"{$before}\" sorts after \"{$after}\".");
        }

        if ($before === null) {
            if ($after === null) {
                return 'a0';
            }

            $integer = self::integerPart($after);
            if ($integer === self::SMALLEST_INTEGER) {
                return $integer.self::midpoint('', substr($after, strlen($integer)));
            }

            // a key with a fraction sorts after its integer part; the smallest integer is no rank and handled above
            return strcmp($integer, $after) < 0 ? $integer : self::decrementInteger($integer);
        }

        $integerBefore = self::integerPart($before);
        $fractionBefore = substr($before, strlen($integerBefore));

        if ($after === null) {
            return self::incrementInteger($integerBefore) ?? $integerBefore.self::midpoint($fractionBefore, null);
        }

        $integerAfter = self::integerPart($after);
        if ($integerBefore === $integerAfter) {
            return $integerBefore.self::midpoint($fractionBefore, substr($after, strlen($integerAfter)));
        }

        // the integer part of $before is below the one of $after, so it is never the largest and always increments
        $next = self::incrementInteger($integerBefore);

        return $next !== null && strcmp($next, $after) < 0 ? $next : $integerBefore.self::midpoint($fractionBefore, null);
    }

    /**
     * `$n` distinct ranks between two neighbours, in order: consecutive integers at the ends, short keys in between.
     *
     * @return list<string>
     *
     * @throws InvalidArgumentException as `between`, and for a negative count
     */
    public static function nBetween(?string $before, ?string $after, int $n): array
    {
        if ($n < 0) {
            throw new InvalidArgumentException("Cannot make {$n} ranks.");
        }
        if ($n === 0) {
            return [];
        }
        if ($n === 1) {
            return [self::between($before, $after)];
        }

        if ($after === null) {
            $keys = [self::between($before, null)];
            for ($i = 1; $i < $n; $i++) {
                $keys[] = self::between($keys[$i - 1], null);
            }

            return $keys;
        }

        if ($before === null) {
            $keys = [self::between(null, $after)];
            for ($i = 1; $i < $n; $i++) {
                $keys[] = self::between(null, $keys[$i - 1]);
            }

            return array_reverse($keys);
        }

        $middle = intdiv($n, 2);
        $key = self::between($before, $after);

        return [...self::nBetween($before, $key, $middle), $key, ...self::nBetween($key, $after, $n - $middle - 1)];
    }

    /** Whether the text is a rank: digits only, a valid integer part, no trailing zero, not the smallest integer. */
    public static function isValid(string $key): bool
    {
        try {
            self::validate($key);

            return true;
        } catch (InvalidArgumentException) {
            return false;
        }
    }

    private static function validate(string $key): void
    {
        if ($key === '' || strspn($key, self::DIGITS) !== strlen($key) || $key === self::SMALLEST_INTEGER) {
            throw new InvalidArgumentException("\"{$key}\" is no rank.");
        }
        if (! str_contains(self::INT_DIGITS, $key[0])) {
            throw new InvalidArgumentException("\"{$key}\" is no rank: it starts with a digit.");
        }

        $integer = self::integerPart($key);
        if (strlen($key) > strlen($integer) && str_ends_with($key, '0')) {
            throw new InvalidArgumentException("\"{$key}\" is no rank: its fraction ends in a zero.");
        }
    }

    /** The number of characters of an integer part with the given head: 2 next to the middle, up to 27 at the ends. */
    private static function integerLength(string $head): int
    {
        $index = (int) strpos(self::INT_DIGITS, $head);
        $half = intdiv(strlen(self::INT_DIGITS), 2);

        return $index < $half ? $half - $index + 1 : $index - $half + 2;
    }

    private static function integerPart(string $key): string
    {
        $length = self::integerLength($key[0]);
        if ($length > strlen($key)) {
            throw new InvalidArgumentException("\"{$key}\" is no rank: its integer part is too short.");
        }

        return substr($key, 0, $length);
    }

    /**
     * A fraction strictly between `$a` and `$b` (`null`: no upper bound); `$a` may be empty. Both are checked by
     * `between`: `$a` sorts before `$b` and neither ends in a zero.
     */
    private static function midpoint(string $a, ?string $b): string
    {
        $zero = self::DIGITS[0];

        if ($b !== null) {
            // drop the common prefix; `$a` is padded with zeros, `$b` cannot end before `$a` on the way
            $n = 0;
            while (($a[$n] ?? $zero) === ($b[$n] ?? null)) {
                $n++;
            }
            if ($n > 0) {
                return substr($b, 0, $n).self::midpoint(substr($a, $n), substr($b, $n));
            }
        }

        // the first digits (or the lack of one) differ
        $digitA = $a !== '' ? (int) strpos(self::DIGITS, $a[0]) : 0;
        $digitB = $b !== null ? (int) strpos(self::DIGITS, $b[0]) : strlen(self::DIGITS);

        if ($digitB - $digitA > 1) {
            return self::DIGITS[intdiv($digitA + $digitB + 1, 2)];
        }

        // the first digits are consecutive
        if ($b !== null && strlen($b) > 1) {
            return $b[0];
        }

        // `$b` is null or a single digit: keep the first digit of `$a` and go on without an upper bound
        return self::DIGITS[$digitA].self::midpoint(substr($a, 1), null);
    }

    /** The next integer, or null for the largest one. */
    private static function incrementInteger(string $integer): ?string
    {
        $head = $integer[0];
        $trailing = '';

        for ($i = strlen($integer) - 1; $i >= 1; $i--) {
            $digit = (int) strpos(self::DIGITS, $integer[$i]) + 1;
            if ($digit < strlen(self::DIGITS)) {
                return $head.substr($integer, 1, $i - 1).self::DIGITS[$digit].$trailing;
            }
            $trailing = self::DIGITS[0].$trailing;
        }

        // carried out of every digit: the head moves up and the digits grow or shrink with it
        $next = substr(self::INT_DIGITS, (int) strpos(self::INT_DIGITS, $head) + 1, 1);
        if ($next === '') {
            // already the largest integer
            return null;
        }
        $delta = self::integerLength($next) - self::integerLength($head);

        return $next.($delta > 0 ? $trailing.self::DIGITS[0] : ($delta < 0 ? substr($trailing, 1) : $trailing));
    }

    /** The previous integer; never called on the smallest one (`between` handles it). */
    private static function decrementInteger(string $integer): string
    {
        $head = $integer[0];
        $last = self::DIGITS[strlen(self::DIGITS) - 1];
        $trailing = '';

        for ($i = strlen($integer) - 1; $i >= 1; $i--) {
            $digit = (int) strpos(self::DIGITS, $integer[$i]) - 1;
            if ($digit >= 0) {
                return $head.substr($integer, 1, $i - 1).self::DIGITS[$digit].$trailing;
            }
            $trailing = $last.$trailing;
        }

        // borrowed from every digit: the head moves down and the digits grow or shrink with it
        $previous = self::INT_DIGITS[(int) strpos(self::INT_DIGITS, $head) - 1];
        $delta = self::integerLength($previous) - self::integerLength($head);

        return $previous.($delta > 0 ? $trailing.$last : ($delta < 0 ? substr($trailing, 1) : $trailing));
    }
}
