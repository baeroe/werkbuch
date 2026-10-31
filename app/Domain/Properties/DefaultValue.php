<?php

namespace App\Domain\Properties;

/**
 * The default value of a property (spec 4.7): checked against the field type and brought into the form it is stored in.
 * `null` is always valid and means no default. The error codes: `text`, `number`, `option`, `single`, `boolean`, `date`,
 * `url`, `none` (the field type has no defaults).
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

        return $text === null || mb_strlen($text) > self::TEXT_MAX
            ? new NormalizedValue(null, 'text')
            : new NormalizedValue($text);
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

        if (is_array($parts) && in_array(strtolower($parts['scheme'] ?? ''), ['http', 'https'], true) && ($parts['host'] ?? '') !== '') {
            return new NormalizedValue($url);
        }

        return new NormalizedValue(null, 'url');
    }
}
