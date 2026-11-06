<?php

namespace App\Support;

use Illuminate\Pagination\Cursor;
use Illuminate\Validation\ValidationException;

/**
 * The check of a cursor before a page is read (K12): Laravel's format (JSON in base64 for URLs) with the values of
 * the last or first row and, for a list with a `ListSpec`, the signature of its order under `_sig` (selected by
 * `ListQuery` as a literal, so the paginator writes it into every cursor, like `App\Views\ItemOrder`).
 *
 * A cursor that does not read, carries a value that is no single value, or names another signature (another sort,
 * or none where the list has one and the other way round) is 422 `field.cursor.invalid` at `cursor`; whether it
 * names the columns of the order, the paginator finds out (`ListResult`).
 */
final class SignedCursor
{
    public const KEY = '_sig';

    private const NEXT = '_pointsToNextItems';

    /**
     * @param  string  $signature  the signature of the order, `''` for a list without one (a fixed list)
     *
     * @throws ValidationException at `cursor`
     */
    public static function decode(?string $encoded, string $signature): ?Cursor
    {
        if ($encoded === null || $encoded === '') {
            return null;
        }

        $parameters = json_decode((string) base64_decode(strtr($encoded, '-_', '+/'), true), true);
        $fits = is_array($parameters) && ! array_is_list($parameters)
            && is_bool($parameters[self::NEXT] ?? null)
            && ($signature === '' ? ! array_key_exists(self::KEY, $parameters) : ($parameters[self::KEY] ?? null) === $signature);
        foreach ($fits ? $parameters : [] as $value) {
            $fits = $fits && ($value === null || is_scalar($value));
        }
        if (! $fits) {
            throw ValidationException::withMessages(['cursor' => __('field.cursor.invalid')]);
        }

        $next = $parameters[self::NEXT];
        unset($parameters[self::NEXT]);

        return new Cursor($parameters, $next);
    }
}
