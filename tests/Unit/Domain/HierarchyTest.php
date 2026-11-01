<?php

use App\Domain\WorkItems\Hierarchy;
use App\Domain\WorkItems\HierarchyRefusal;

it('goes by the Epic mark of the type, never by its name', function () {
    // the rule only ever sees the mark: a type called "Epic" without it is a plain type, one with it an epic
    expect(Hierarchy::canHaveChildren(true))->toBeTrue()
        ->and(Hierarchy::canHaveParent(true))->toBeFalse()
        ->and(Hierarchy::canHaveChildren(false))->toBeFalse()
        ->and(Hierarchy::canHaveParent(false))->toBeTrue();
});

it('says why a type change would break the two levels, children before parent', function () {
    expect(Hierarchy::typeChangeRefusal(hasChildren: true, hasParent: false, targetIsEpic: false))->toBe(HierarchyRefusal::HasChildren)
        ->and(Hierarchy::typeChangeRefusal(hasChildren: false, hasParent: true, targetIsEpic: true))->toBe(HierarchyRefusal::HasParent)
        // an item with both (which the two levels never allow) is refused for its children first
        ->and(Hierarchy::typeChangeRefusal(hasChildren: true, hasParent: true, targetIsEpic: false))->toBe(HierarchyRefusal::HasChildren)
        ->and(Hierarchy::typeChangeRefusal(hasChildren: true, hasParent: true, targetIsEpic: true))->toBe(HierarchyRefusal::HasParent)
        // what keeps the two levels
        ->and(Hierarchy::typeChangeRefusal(hasChildren: true, hasParent: false, targetIsEpic: true))->toBeNull()
        ->and(Hierarchy::typeChangeRefusal(hasChildren: false, hasParent: true, targetIsEpic: false))->toBeNull()
        ->and(Hierarchy::typeChangeRefusal(hasChildren: false, hasParent: false, targetIsEpic: true))->toBeNull()
        ->and(Hierarchy::typeChangeRefusal(hasChildren: false, hasParent: false, targetIsEpic: false))->toBeNull();
});

it('an unknown type has no children, and nothing says it cannot have a parent', function () {
    // callers pass false for a type they do not know, as the clickdummy treats a missing type
    expect(Hierarchy::canHaveChildren(false))->toBeFalse()
        ->and(Hierarchy::canHaveParent(false))->toBeTrue();
});

it('names the reason codes of the API', function () {
    expect(HierarchyRefusal::HasChildren->value)->toBe('has_children')
        ->and(HierarchyRefusal::HasParent->value)->toBe('has_parent')
        ->and(HierarchyRefusal::HasChildren->reason())->toBe('parent_not_epic')
        ->and(HierarchyRefusal::HasParent->reason())->toBe('epic_has_no_parent');
});
