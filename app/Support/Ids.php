<?php

namespace App\Support;

use Illuminate\Support\Str;

/**
 * Input IDs in one case: a ULID comes in as anything and is stored in lower case, while a local ID of a new state or
 * option (`st_ABC`) stays as it came (P3). Lists and maps are done element by element.
 */
final class Ids
{
    public static function normalize(mixed $value): mixed
    {
        if (is_string($value)) {
            return self::normalizeString($value);
        }

        if (is_array($value)) {
            $normalized = [];

            foreach ($value as $key => $item) {
                $normalized[is_string($key) ? self::normalizeString($key) : $key] = self::normalize($item);
            }

            return $normalized;
        }

        return $value;
    }

    private static function normalizeString(string $value): string
    {
        return Str::isUlid($value) ? strtolower($value) : $value;
    }
}
