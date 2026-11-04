<?php

namespace App\Domain\Schedule;

use DateTimeImmutable;
use DateTimeZone;

/**
 * Placeholders in the titles of templates (spec 4.12, port of `placeholders.ts`): `{date}` 2026-11-02, `{week}` the
 * ISO calendar week, `{month}` 11, `{month_name}` the name of the month, `{quarter}` 4, `{year}` 2026, read on the
 * calendar of the zone. `{week}` and `{month}` have two digits. Text that is no known placeholder stays as it is.
 * Month names come from the caller (the language of the organisation, A353).
 */
final class Placeholders
{
    public const NAMES = ['date', 'week', 'month', 'month_name', 'quarter', 'year'];

    private const PLACEHOLDER = '/\{([a-z_]+)\}/';

    /**
     * @param  array<int, string>  $monthNames  1 … 12 → name
     */
    public static function render(string $title, DateTimeImmutable $at, DateTimeZone $zone, array $monthNames): string
    {
        $local = $at->setTimezone($zone);
        $month = (int) $local->format('n');
        $values = [
            'date' => $local->format('Y-m-d'),
            'week' => $local->format('W'),
            'month' => $local->format('m'),
            'month_name' => $monthNames[$month],
            'quarter' => (string) (intdiv($month - 1, 3) + 1),
            'year' => $local->format('Y'),
        ];

        return self::fill($title, $values);
    }

    /**
     * The length of the title (characters, not bytes) when every placeholder takes its longest filling: what a
     * title of a run can grow to.
     *
     * @param  array<int, string>  $monthNames
     */
    public static function longest(string $title, array $monthNames): int
    {
        $longestName = max([0, ...array_map(mb_strlen(...), $monthNames)]);
        $lengths = ['date' => 10, 'week' => 2, 'month' => 2, 'month_name' => $longestName, 'quarter' => 1, 'year' => 4];

        return mb_strlen(self::fill($title, array_map(fn (int $length): string => str_repeat('x', $length), $lengths)));
    }

    /**
     * @param  array<string, string>  $values
     */
    private static function fill(string $title, array $values): string
    {
        return (string) preg_replace_callback(
            self::PLACEHOLDER,
            fn (array $match): string => $values[$match[1]] ?? $match[0],
            $title,
        );
    }
}
