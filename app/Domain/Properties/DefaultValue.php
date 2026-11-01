<?php

namespace App\Domain\Properties;

/**
 * The default value of a property (spec 4.7): checked against the field type and brought into the form it is stored in,
 * by the same rule as the values of items (`ItemValue`). `null` is always valid and means no default; so do a blank text
 * and an empty list of options. The error codes: `text`, `number`, `number_range`, `option`, `single`, `boolean`, `date`, `url` (no http
 * or https, or longer than 2048 characters), `url_invalid` (no host, or blanks, control or format characters such as a
 * zero width space inside), `none` (the field type has no defaults).
 */
final class DefaultValue
{
    public const TEXT_MAX = ItemValue::TEXT_MAX;

    /**
     * @param  list<string>  $optionIds  the options that are not archived
     */
    public static function normalize(FieldType $type, int $decimals, bool $multiple, array $optionIds, mixed $value): NormalizedValue
    {
        if ($value === null) {
            return new NormalizedValue(null);
        }
        if (! $type->hasDefault()) {
            return new NormalizedValue(null, 'none');
        }

        return ItemValue::normalize(new PropertyShape($type, $decimals, $multiple, $optionIds), $value);
    }
}
