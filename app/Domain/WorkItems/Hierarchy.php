<?php

namespace App\Domain\WorkItems;

/**
 * Parents and children (spec 4.8): two levels. Only epics have child items, and epics have no parent themselves. An
 * epic is an item whose type carries the Epic mark (`is_epic`), never a type of that name.
 */
final class Hierarchy
{
    /** Whether items of the type may have child items: epics only. */
    public static function canHaveChildren(bool $isEpic): bool
    {
        return $isEpic;
    }

    /** Whether items of the type may have a parent: every type but an epic, which stands at the top. */
    public static function canHaveParent(bool $isEpic): bool
    {
        return ! self::canHaveChildren($isEpic);
    }

    /** Why an item cannot take a type without breaking the two levels (its children first); null when it can. */
    public static function typeChangeRefusal(bool $hasChildren, bool $hasParent, bool $targetIsEpic): ?HierarchyRefusal
    {
        if ($hasChildren && ! self::canHaveChildren($targetIsEpic)) {
            return HierarchyRefusal::HasChildren;
        }
        if ($hasParent && ! self::canHaveParent($targetIsEpic)) {
            return HierarchyRefusal::HasParent;
        }

        return null;
    }
}
