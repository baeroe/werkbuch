<?php

namespace Tests\Support;

use App\Domain\Filter\PropertyCatalog;
use App\Domain\Properties\FieldType;
use App\Domain\Properties\PropertyShape;

/**
 * The properties of an organisation for the pure rules of filters and displays: one of each field type, the choices
 * single and multiple.
 */
final class FixedPropertyCatalog implements PropertyCatalog
{
    public function shape(string $key): ?PropertyShape
    {
        return match ($key) {
            'customer' => new PropertyShape(FieldType::Dropdown, 0, false, []),
            'platforms' => new PropertyShape(FieldType::Dropdown, 0, true, []),
            'reviewer' => new PropertyShape(FieldType::Member, 0, false, []),
            'reviewers' => new PropertyShape(FieldType::Member, 0, true, []),
            'effort' => new PropertyShape(FieldType::Number, 1, false, []),
            'launch' => new PropertyShape(FieldType::Date, 0, false, []),
            'approved' => new PropertyShape(FieldType::Boolean, 0, false, []),
            'browser' => new PropertyShape(FieldType::Text, 0, false, []),
            'link' => new PropertyShape(FieldType::Url, 0, false, []),
            'notes' => new PropertyShape(FieldType::RichText, 0, false, []),
            default => null,
        };
    }
}
