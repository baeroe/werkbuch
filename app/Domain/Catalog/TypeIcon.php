<?php

namespace App\Domain\Catalog;

/**
 * The icons a work item type can carry: the names the interface draws (`TYPE_ICONS` in `TypeTab.tsx`).
 */
final class TypeIcon
{
    public const NAMES = [
        'square-check', 'bug', 'zap', 'layers', 'message-square-heart', 'book-open', 'clipboard-list', 'file-text', 'flag',
        'flask-conical', 'lightbulb', 'megaphone', 'package', 'palette', 'rocket', 'shield', 'star', 'target', 'users', 'wrench',
    ];

    public static function isKnown(string $name): bool
    {
        return in_array($name, self::NAMES, true);
    }
}
