<?php

namespace App\Domain\Properties;

use App\Domain\WorkItems\DateRange;

/**
 * The value of a property on a work item (spec 4.7), as `values.ts` of the clickdummy checks it: brought into the form
 * it is stored in, or refused with a code. `null` is always valid and means no value; so do a blank text and an empty
 * list. Whether people may be picked (`Assignable`) and whether a document fits the schema (`Document`) is checked by
 * the caller (`ItemValues`), which also gives the ids normalized (`Ids::normalize`).
 *
 * The codes: `text` (no text or longer than 255 characters), `number`, `number_range` (a number the column cannot hold:
 * not below `NUMBER_LIMIT` in amount after rounding), `option` (no active option and not the one the item has), `single` (a list for a property with one value), `boolean`, `date`, `url` (no http or https, or longer than
 * 2048 characters), `url_invalid` (no host, or blanks, control or format characters inside), `member` (no ULID),
 * `rich_text` (no document).
 */
final class ItemValue
{
    public const TEXT_MAX = 255;

    /** The size of `work_item_values.value_string`. */
    public const URL_MAX = 2048;

    /**
     * Numbers must stay below this in amount: `work_item_values.value_number` is `decimal(24,4)`, so 20 digits before
     * the point; a larger value would fail the insert with an error of the database (a 500).
     */
    public const NUMBER_LIMIT = 1e20;

    /** A ULID as the `ulid` rule takes it: 26 characters of Crockford's alphabet, the first one 0-7. */
    private const ULID = '/^[0-7][0-9a-hjkmnp-tv-z]{25}\z/i';

    /**
     * @param  mixed  $current  the value the item has: an archived option it already has stays valid
     */
    public static function normalize(PropertyShape $shape, mixed $value, mixed $current = null): NormalizedValue
    {
        if ($value === null) {
            return new NormalizedValue(null);
        }

        return match ($shape->type) {
            FieldType::Text => self::text($value),
            FieldType::Number => self::number($value, $shape->decimals),
            FieldType::Dropdown => self::dropdown($value, $shape, $current),
            FieldType::Boolean => is_bool($value) ? new NormalizedValue($value) : new NormalizedValue(null, 'boolean'),
            FieldType::Date => is_string($value) && DateRange::isDay($value) ? new NormalizedValue($value) : new NormalizedValue(null, 'date'),
            FieldType::Url => self::url($value),
            FieldType::Member => self::member($value, $shape->multiple),
            FieldType::RichText => is_array($value) && ($value['type'] ?? null) === 'doc' ? new NormalizedValue($value) : new NormalizedValue(null, 'rich_text'),
        };
    }

    /** Whether a value counts as none: nothing, a blank text, an empty list or a blank document; numbers and booleans never. */
    public static function isEmpty(mixed $value): bool
    {
        if (is_string($value)) {
            return trim($value) === '';
        }
        if (is_array($value)) {
            return array_is_list($value) ? $value === [] : self::isBlankDoc($value);
        }

        return $value === null;
    }

    /**
     * Whether a document has no text and no mention (an editor that was emptied still holds an empty paragraph). Text
     * counts as blank when it has only blanks as JavaScript's `\s` knows them.
     *
     * @param  array<mixed>  $doc
     */
    public static function isBlankDoc(array $doc): bool
    {
        if (is_string($doc['text'] ?? null)) {
            return preg_match('/^[\s\x{FEFF}]*\z/u', $doc['text']) === 1;
        }
        if (($doc['type'] ?? null) === 'mention') {
            return false;
        }

        $children = $doc['content'] ?? [];
        foreach (is_array($children) ? $children : [] as $child) {
            if (is_array($child) && ! self::isBlankDoc($child)) {
                return false;
            }
        }

        return true;
    }

    private static function text(mixed $value): NormalizedValue
    {
        $text = is_string($value) ? trim($value) : null;

        if ($text === null || mb_strlen($text) > self::TEXT_MAX) {
            return new NormalizedValue(null, 'text');
        }

        // a blank text is no value
        return new NormalizedValue($text === '' ? null : $text);
    }

    private static function number(mixed $value, int $decimals): NormalizedValue
    {
        if (is_string($value) && preg_match('/^-?\d+([.,]\d+)?\z/', $value) === 1) {
            $value = (float) str_replace(',', '.', $value);
        }

        if ((! is_int($value) && ! is_float($value)) || ! is_finite((float) $value)) {
            return new NormalizedValue(null, 'number');
        }

        $rounded = round((float) $value, $decimals);
        if (abs($rounded) >= self::NUMBER_LIMIT) {
            return new NormalizedValue(null, 'number_range');
        }

        // whole numbers are stored as integers (7, not 7.0)
        return new NormalizedValue(abs($rounded) < 1e15 && floor($rounded) === $rounded ? (int) $rounded : $rounded);
    }

    private static function dropdown(mixed $value, PropertyShape $shape, mixed $current): NormalizedValue
    {
        if (is_array($value) && ! $shape->multiple) {
            return new NormalizedValue(null, 'single');
        }

        $ids = is_array($value) ? array_values($value) : [$value];

        // no option chosen is no value
        if ($ids === []) {
            return new NormalizedValue(null);
        }

        $kept = is_array($current) ? $current : [$current];
        foreach ($ids as $id) {
            if (! is_string($id) || (! in_array($id, $shape->activeOptionIds, true) && ! in_array($id, $kept, true))) {
                return new NormalizedValue(null, 'option');
            }
        }

        return new NormalizedValue($shape->multiple ? array_values(array_unique($ids)) : $ids[0]);
    }

    private static function member(mixed $value, bool $multiple): NormalizedValue
    {
        if (is_array($value) && ! $multiple) {
            return new NormalizedValue(null, 'single');
        }

        $ids = is_array($value) ? array_values($value) : [$value];

        // nobody picked is no value
        if ($ids === []) {
            return new NormalizedValue(null);
        }

        foreach ($ids as $id) {
            if (! is_string($id) || preg_match(self::ULID, $id) !== 1) {
                return new NormalizedValue(null, 'member');
            }
        }

        return new NormalizedValue($multiple ? array_values(array_unique($ids)) : $ids[0]);
    }

    private static function url(mixed $value): NormalizedValue
    {
        $url = is_string($value) ? trim($value) : null;

        if ($url === null || preg_match('~^https?://~i', $url) !== 1 || mb_strlen($url) > self::URL_MAX) {
            return new NormalizedValue(null, 'url');
        }

        $parts = parse_url($url);

        // any letters in host, path and query (müller.de, /straße), but a host, and no blanks or control characters; a
        // text that is no UTF-8 at all fails the match as well
        if (! is_array($parts) || ($parts['host'] ?? '') === '' || preg_match('/[\s\p{Z}\p{Cc}\p{Cf}]/u', $url) !== 0) {
            return new NormalizedValue(null, 'url_invalid');
        }

        return new NormalizedValue($url);
    }
}
