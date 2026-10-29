import { describe, expect, it } from 'vitest';
import { types } from '@/api/seed/config';
import type { WorkItemType } from '@/types';
import { canHaveChildren, canHaveParent } from './hierarchy';

const typeNamed = (name: string) => types.find((type) => type.name === name)!;

describe('two levels: epics have children, everything else has a parent', () => {
  it('goes by the Epic mark of the type, never by its name', () => {
    expect(canHaveChildren(typeNamed('Epic'))).toBe(true);
    expect(canHaveParent(typeNamed('Epic'))).toBe(false);
    expect(canHaveChildren(typeNamed('Task'))).toBe(false);
    expect(canHaveParent(typeNamed('Task'))).toBe(true);

    // a type called "Epic" without the mark is a plain type, a type with the mark is an epic under any name
    const unmarked: WorkItemType = { ...typeNamed('Epic'), is_epic: false };
    const initiative: WorkItemType = { ...typeNamed('Kundenwunsch'), name: 'Initiative', is_epic: true };
    expect(canHaveChildren(unmarked)).toBe(false);
    expect(canHaveParent(unmarked)).toBe(true);
    expect(canHaveChildren(initiative)).toBe(true);
    expect(canHaveParent(initiative)).toBe(false);
  });

  it('an unknown type has no children, and nothing says it cannot have a parent', () => {
    expect(canHaveChildren(undefined)).toBe(false);
    expect(canHaveParent(undefined)).toBe(true);
  });
});
