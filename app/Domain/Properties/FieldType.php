<?php

namespace App\Domain\Properties;

/**
 * The field types of a custom property (spec 4.7).
 */
enum FieldType: string
{
    case Text = 'text';
    case Number = 'number';
    case Dropdown = 'dropdown';
    case Boolean = 'boolean';
    case Date = 'date';
    case Member = 'member';
    case RichText = 'rich_text';
    case Url = 'url';

    /** Whether the property lists options. */
    public function hasOptions(): bool
    {
        return $this === self::Dropdown;
    }

    /** Whether the property can hold several values. */
    public function allowsMultiple(): bool
    {
        return $this === self::Dropdown || $this === self::Member;
    }

    /** Whether the property has a setting for decimals. */
    public function hasDecimals(): bool
    {
        return $this === self::Number;
    }

    /** Whether the property can have a default value; people and long texts cannot. */
    public function hasDefault(): bool
    {
        return $this !== self::Member && $this !== self::RichText;
    }
}
