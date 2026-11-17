<?php

namespace App\Domain\Properties;

/**
 * Where a property shows on an item (WEBU-6): in the side panel of fields, or in the body below the description. One
 * choice per property, for every type. A new property takes `forType`: rich text below the description (it needs the
 * width), everything else in the side panel.
 */
enum Placement: string
{
    case Sidebar = 'sidebar';
    case Body = 'body';

    public static function forType(FieldType $type): self
    {
        return $type === FieldType::RichText ? self::Body : self::Sidebar;
    }
}
