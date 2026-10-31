<?php

namespace App\Domain\WorkItems;

/**
 * Why a type change would break the two levels (spec 4.8): the item has children and the new type is no epic, or it
 * has a parent and the new type is an epic.
 */
enum HierarchyRefusal: string
{
    case HasChildren = 'has_children';
    case HasParent = 'has_parent';

    /** The `reason` code of the problem the API answers (`Problem::REASONS`). */
    public function reason(): string
    {
        return match ($this) {
            self::HasChildren => 'parent_not_epic',
            self::HasParent => 'epic_has_no_parent',
        };
    }
}
