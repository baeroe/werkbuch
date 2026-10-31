<?php

namespace App\Domain\Properties;

/**
 * The default value of a property (spec 4.7): checked against the field type and brought into the form it is stored in.
 * `null` is always valid and means no default; so do a blank text and an empty list of options. The error codes: `text`,
 * `number`, `option`, `single`, `boolean`, `date`, `url`, `none` (the field type has no defaults).
 */
final class DefaultValue
{
    public const TEXT_MAX = 255;

    /**
     * @param  list<string>  $optionIds
     */
    public static function normalize(FieldType $type, int $decimals, bool $multiple, array $optionIds, mixed $value): NormalizedValue
    {
        if ($value === null) {
            return new NormalizedValue(null);
        }

        return match ($type) {
            FieldType::Text => self::text($value),
            FieldType::Number => self::number($value, $decimals),
            FieldType::Dropdown => self::dropdown($value, $multiple, $optionIds),
            FieldType::Boolean => is_bool($value) ? new NormalizedValue($value) : new NormalizedValue(null, 'boolean'),
            FieldType::Date => self::date($value),
            FieldType::Url => self::url($value),
            FieldType::Member, FieldType::RichText => new NormalizedValue(null, 'none'),
        };
    }

    private static function text(mixed $value): NormalizedValue
    {
        $text = is_string($value) ? trim($value) : null;

        if ($text === null || mb_strlen($text) > self::TEXT_MAX) {
            return new NormalizedValue(null, 'text');
        }

        // a blank text is no default
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

        // whole numbers are stored as integers (7, not 7.0)
        return new NormalizedValue(abs($rounded) < 1e15 && floor($rounded) === $rounded ? (int) $rounded : $rounded);
    }

    /**
     * @param  list<string>  $optionIds
     */
    private static function dropdown(mixed $value, bool $multiple, array $optionIds): NormalizedValue
    {
        if (is_array($value) && ! $multiple) {
            return new NormalizedValue(null, 'single');
        }

        $ids = is_array($value) ? array_values($value) : [$value];

        // no option chosen is no default
        if ($ids === []) {
            return new NormalizedValue(null);
        }

        foreach ($ids as $id) {
            if (! is_string($id) || ! in_array($id, $optionIds, true)) {
                return new NormalizedValue(null, 'option');
            }
        }

        return new NormalizedValue($multiple ? array_values(array_unique($ids)) : $ids[0]);
    }

    private static function date(mixed $value): NormalizedValue
    {
        if (is_string($value) && preg_match('/^(\d{4})-(\d{2})-(\d{2})\z/', $value, $parts) === 1
            && checkdate((int) $parts[2], (int) $parts[3], (int) $parts[1])) {
            return new NormalizedValue($value);
        }

        return new NormalizedValue(null, 'date');
    }

    private static function url(mixed $value): NormalizedValue
    {
        $url = is_string($value) ? trim($value) : '';
        $parts = parse_url($url);

        // http or https with a host, and a URL as PHP checks one: no blanks or control characters inside, a host of
        // letters, digits, dots and hyphens
        if (is_array($parts) && in_array(strtolower($parts['scheme'] ?? ''), ['http', 'https'], true) && ($parts['host'] ?? '') !== ''
            && filter_var($url, FILTER_VALIDATE_URL) !== false) {
            return new NormalizedValue($url);
        }

        return new NormalizedValue(null, 'url');
    }
}
